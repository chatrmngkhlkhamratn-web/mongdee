// Customer-facing product showcase: a browsable grid; tapping a card opens
// the same detail popup the kiosk shows when it recognizes a held product.
const grid = document.getElementById("showcaseGrid");
const showcaseStatus = document.getElementById("showcaseStatus");
const popup = document.getElementById("productPopup");
const popupContent = document.getElementById("popupContent");
const popupCloseBtn = document.getElementById("popupCloseBtn");
const dialogSupported = popup && typeof popup.showModal === "function";

let systemMuted = true;
try { systemMuted = localStorage.getItem("mongdee_muted") !== "false"; } catch (e) { /* private mode */ }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatMoney(n) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function formatThaiDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || "");
  if (!m) return isoDate;
  const [, y, mo, d] = m;
  return `${parseInt(d, 10)} ${THAI_MONTHS[parseInt(mo, 10) - 1]} ${parseInt(y, 10) + 543}`;
}

function productImage(p) {
  const src = p.cover_image_path || p.thumbnail_path;
  if (!src) return null;
  const img = el("img");
  img.src = "/" + src;
  img.alt = p.name;
  img.loading = "lazy";
  return img;
}

// Turns a YouTube/Vimeo/Facebook watch link into its autoplay embed URL —
// see the identical helper in kiosk.js for the customer-facing scan flow.
function videoEmbedUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch (err) {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtube.com") {
    const id = u.searchParams.get("v") || u.pathname.match(/^\/shorts\/([\w-]+)/)?.[1];
    if (id) return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1`;
  } else if (host === "youtu.be") {
    const id = u.pathname.slice(1);
    if (id) return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1`;
  } else if (host === "vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    if (id) return `https://player.vimeo.com/video/${id}?autoplay=1&muted=1`;
  } else if (host === "facebook.com" || host === "fb.watch") {
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(rawUrl)}&autoplay=true&mute=1`;
  }
  return null;
}

function buildDetail(p) {
  popupContent.replaceChildren();

  const media = el("div", "popup-media");
  const embedUrl = !p.video_path && p.video_link ? videoEmbedUrl(p.video_link) : null;
  let defaultNode;
  if (p.video_path) {
    const video = el("video");
    video.src = "/" + p.video_path;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.muted = systemMuted;
    video.controls = true;
    defaultNode = video;
  } else if (embedUrl) {
    const iframe = el("iframe");
    iframe.src = embedUrl;
    iframe.title = p.name;
    iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    iframe.allowFullscreen = true;
    defaultNode = iframe;
  } else {
    defaultNode = productImage(p);
  }
  mountMediaWithSpinToggle(media, { defaultNode, frameUrls: p.spin_frames, altText: p.name });
  if (media.childElementCount) popupContent.append(media);

  const body = el("div", "popup-body");
  body.append(el("h2", "popup-title", p.name));
  if (p.price != null) body.append(el("div", "popup-price", `฿${formatMoney(p.price)}`));

  const metaRow = el("div", "meta-row");
  if (p.category) metaRow.append(el("span", "pill", p.category));
  if (metaRow.childElementCount) body.append(metaRow);

  const fields = [
    ["แหล่งที่มา", p.origin],
    ["วัสดุ", p.material],
    ["วิธีการผลิต", p.process],
    ["วันผลิต", p.production_date ? formatThaiDate(p.production_date) : null],
    ["วันหมดอายุ", p.expiry_date ? formatThaiDate(p.expiry_date) : null],
  ];
  for (const [label, value] of fields) {
    if (!value) continue;
    body.append(el("div", "field-label", label));
    body.append(el("div", "", value));
  }
  if (p.story) {
    body.append(el("div", "field-label", "เรื่องราว"));
    body.append(el("div", "story", p.story));
  }
  const actions = el("div", "popup-actions");
  if (p.video_link && !embedUrl) {
    const videoLink = el("a", "video-cta");
    videoLink.href = p.video_link;
    videoLink.target = "_blank";
    videoLink.rel = "noopener";
    videoLink.append(el("span", "video-cta-icon", "▶"), el("span", "", "ดูวิดีโอ"));
    actions.append(videoLink);
  }
  if (p.video_url) {
    const contactLink = el("a", "video-cta");
    contactLink.href = p.video_url;
    contactLink.target = "_blank";
    contactLink.rel = "noopener";
    contactLink.append(el("span", "video-cta-icon", "🔗"), el("span", "", "ช่องทางติดต่อ / ข้อมูลเพิ่มเติม"));
    actions.append(contactLink);
  }
  if (actions.childElementCount) body.append(actions);
  popupContent.append(body);
}

function openDetail(p) {
  if (!dialogSupported) return;
  buildDetail(p);
  if (!popup.open) popup.showModal();
}

function closeDetail() {
  if (!dialogSupported) return;
  const video = popupContent.querySelector("video");
  if (video) video.pause();
  if (popup.open) popup.close();
}

if (dialogSupported) {
  popupCloseBtn?.addEventListener("click", closeDetail);
  popup.addEventListener("cancel", (e) => { e.preventDefault(); closeDetail(); });
  popup.addEventListener("click", (e) => {
    const box = popup.getBoundingClientRect();
    if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) closeDetail();
  });
}

function card(p) {
  const item = el("button", "showcase-card");
  item.type = "button";
  const media = el("div", "showcase-media");
  const img = productImage(p);
  if (img) media.append(img);
  else media.append(el("div", "showcase-media-empty", "ไม่มีภาพ"));
  if (p.video_path) media.append(el("span", "showcase-badge", "▶ วิดีโอ"));
  item.append(media);

  const body = el("div", "showcase-body");
  body.append(el("div", "showcase-name", p.name));
  const meta = [p.category, p.price == null ? null : `฿${formatMoney(p.price)}`].filter(Boolean).join(" · ");
  body.append(el("div", "showcase-meta", meta || " "));
  item.append(body);

  item.addEventListener("click", () => openDetail(p));
  return item;
}

async function load() {
  try {
    const res = await fetch("/api/products", { cache: "no-store" });
    if (!res.ok) throw new Error("โหลดรายการสินค้าไม่สำเร็จ");
    const products = await res.json();
    grid.replaceChildren(...products.map(card));
    showcaseStatus.textContent = products.length
      ? "แตะที่สินค้าเพื่อดูรายละเอียดและวิดีโอ"
      : "ยังไม่มีสินค้าในระบบ";
  } catch (err) {
    showcaseStatus.textContent = err.message;
  }
}

load();
