"""SQLite persistence layer.

Kept as plain sqlite3 (no ORM) since the schema is small and stable —
easy to inspect the .db file directly with any SQLite browser during
on-site debugging at the booth.
"""
import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

from app import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    origin TEXT,
    material TEXT,
    process TEXT,
    story TEXT,
    video_url TEXT,
    video_link TEXT,
    thumbnail_path TEXT,
    cover_image_path TEXT,
    video_path TEXT,
    price REAL,
    production_date TEXT,
    expiry_date TEXT,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS product_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    embedding TEXT NOT NULL,   -- JSON list[float], L2-normalized
    image_path TEXT,
    version INTEGER NOT NULL DEFAULT 1,  -- config.EMBED_VERSION at creation; older ones are excluded from matching
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    confidence REAL,
    matched INTEGER NOT NULL,       -- 0/1: was it shown as a confident match
    corrected INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embeddings_product ON product_embeddings(product_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_product ON scan_events(product_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_created ON scan_events(created_at);
"""


def init_db() -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.CAPTURES_DIR.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        _ensure_column(conn, "products", "video_url", "TEXT")
        _ensure_column(conn, "products", "video_link", "TEXT")
        _ensure_column(conn, "products", "cover_image_path", "TEXT")
        _ensure_column(conn, "products", "video_path", "TEXT")
        _ensure_column(conn, "products", "price", "REAL")
        _ensure_column(conn, "products", "production_date", "TEXT")
        _ensure_column(conn, "products", "expiry_date", "TEXT")
        _ensure_column(conn, "product_embeddings", "version", "INTEGER NOT NULL DEFAULT 1")


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, coltype: str) -> None:
    """Adds a column to an already-existing db file from an earlier schema
    version, so upgrading the app doesn't require deleting local data."""
    existing = [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# --- Products --------------------------------------------------------------

def create_product(
    name, category, origin, material, process, story, video_url, thumbnail_path,
    price=None, production_date=None, expiry_date=None, embeddings=None,
    embedding_version=None, video_link=None, frame_image_paths=None,
) -> int:
    if embedding_version is None:
        embedding_version = config.EMBED_VERSION
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO products (name, category, origin, material, process, story, video_url, video_link,
                                      thumbnail_path, price, production_date, expiry_date, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (name, category, origin, material, process, story, video_url, video_link, thumbnail_path,
             price, production_date, expiry_date, time.time()),
        )
        product_id = cur.lastrowid
        # Enrollment is one transaction: never leave a product with only a
        # partial set of reference views after a failed write.
        if embeddings is not None:
            # frame_image_paths (when given) is positionally parallel to
            # embeddings — one saved angle photo per training embedding, in
            # capture order, so the popup's spin viewer can play them back
            # as a 360-style sequence (see get_product_frames).
            paths = frame_image_paths if frame_image_paths is not None else [None] * len(embeddings)
            conn.executemany(
                "INSERT INTO product_embeddings (product_id, embedding, image_path, version, created_at) VALUES (?, ?, ?, ?, ?)",
                [(product_id, json.dumps(vector), path, embedding_version, time.time())
                 for vector, path in zip(embeddings, paths)],
            )
        return product_id


def get_product_frames(product_id: int) -> list[str]:
    """The saved angle photos for a product's training embeddings, in
    capture order (row id order) — the frame sequence for the 360 spin
    viewer. Empty for products enrolled before frame images were kept."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT image_path FROM product_embeddings WHERE product_id = ? AND image_path IS NOT NULL ORDER BY id",
            (product_id,),
        ).fetchall()
    return [r["image_path"] for r in rows]


def product_out_fields(row) -> dict:
    """dict(row) plus the derived fields ProductOut needs beyond the raw
    products table columns — the single place every ProductOut(**...) call
    site should build its kwargs from, so new derived fields land everywhere
    at once."""
    data = dict(row)
    data["spin_frames"] = get_product_frames(data["id"])
    return data


_EDITABLE_PRODUCT_FIELDS = {
    "name", "category", "origin", "material", "process", "story", "video_url", "video_link",
    "price", "production_date", "expiry_date",
}


def update_product(product_id: int, **fields) -> None:
    """fields keys must come from ProductUpdate (schemas.py), not raw
    request data, so this whitelist is a defense-in-depth check, not the
    only guard against arbitrary column names."""
    fields = {k: v for k, v in fields.items() if k in _EDITABLE_PRODUCT_FIELDS}
    if not fields:
        return
    columns = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(f"UPDATE products SET {columns} WHERE id = ?", [*fields.values(), product_id])


def set_cover_image(product_id: int, path: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE products SET cover_image_path = ? WHERE id = ?", (path, product_id))


def set_product_video(product_id: int, path: Optional[str]) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE products SET video_path = ? WHERE id = ?", (path, product_id))


def add_embedding(product_id: int, embedding: list, image_path: Optional[str], version: Optional[int] = None) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO product_embeddings (product_id, embedding, image_path, version, created_at) VALUES (?, ?, ?, ?, ?)",
            (product_id, json.dumps(embedding), image_path, version or config.EMBED_VERSION, time.time()),
        )


def list_products() -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM products ORDER BY created_at DESC").fetchall()


def get_product(product_id: int) -> Optional[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()


def delete_product(product_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM products WHERE id = ?", (product_id,))


def all_embeddings() -> list[sqlite3.Row]:
    """(product_id, embedding json) rows for the CURRENT embedding version,
    used to rebuild the in-memory matching index. Rows from an older version
    describe a different preprocessing pipeline and are left out so they
    can't produce misleading matches."""
    with get_conn() as conn:
        return conn.execute(
            "SELECT product_id, embedding FROM product_embeddings WHERE version = ?",
            (config.EMBED_VERSION,),
        ).fetchall()


def stale_product_ids() -> set[int]:
    """Products that have no embedding at the current version — they were
    enrolled under an older pipeline and need a one-time re-scan before the
    kiosk can recognize them again."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT p.id AS id
               FROM products p
               WHERE NOT EXISTS (
                   SELECT 1 FROM product_embeddings e
                   WHERE e.product_id = p.id AND e.version = ?
               )""",
            (config.EMBED_VERSION,),
        ).fetchall()
    return {row["id"] for row in rows}


# --- Scan events / analytics -----------------------------------------------

def log_scan_event(product_id: Optional[int], confidence: Optional[float], matched: bool) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO scan_events (product_id, confidence, matched, created_at) VALUES (?, ?, ?, ?)",
            (product_id, confidence, int(matched), time.time()),
        )
        return cur.lastrowid


def correct_scan_event(scan_event_id: int, product_id: int) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE scan_events SET product_id = ?, matched = 1, corrected = 1 WHERE id = ?",
            (product_id, scan_event_id),
        )


def analytics_summary() -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            """SELECT p.id as product_id, p.name as name, COUNT(s.id) as scan_count,
                      AVG(s.confidence) as avg_confidence, MAX(s.created_at) as last_scan
               FROM products p
               LEFT JOIN scan_events s ON s.product_id = p.id AND s.matched = 1
               GROUP BY p.id
               ORDER BY scan_count DESC"""
        ).fetchall()


def analytics_hourly() -> list[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute(
            """SELECT CAST(strftime('%H', created_at, 'unixepoch', 'localtime') AS INTEGER) as hour,
                      COUNT(*) as count
               FROM scan_events
               WHERE matched = 1
               GROUP BY hour
               ORDER BY hour"""
        ).fetchall()


# --- Settings (small persisted key/value store, e.g. chosen camera index) --

def get_setting(key: str, default: Optional[str] = None) -> Optional[str]:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
