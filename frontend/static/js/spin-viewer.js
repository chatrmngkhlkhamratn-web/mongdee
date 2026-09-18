// 360-style spin viewer for the product detail popup: plays back the
// angle photos saved during enrollment (product.spin_frames, in capture
// order) as a drag-to-rotate sequence, the same interaction pattern as a
// typical e-commerce 360 product view. Shared by kiosk.js and products.js.
function buildSpinViewer(frameUrls, altText) {
  const wrap = document.createElement("div");
  wrap.className = "spin-viewer";

  const img = document.createElement("img");
  img.alt = altText || "";
  img.draggable = false;
  img.src = "/" + frameUrls[0];
  wrap.append(img);

  const hint = document.createElement("div");
  hint.className = "spin-hint";
  hint.textContent = "ลากเพื่อหมุนดูรอบสินค้า ↔";
  wrap.append(hint);

  const PX_PER_FRAME = 10;
  let index = 0;
  let dragging = false;
  let startX = 0;
  let startIndex = 0;

  function setIndex(i) {
    index = ((i % frameUrls.length) + frameUrls.length) % frameUrls.length;
    img.src = "/" + frameUrls[index];
  }

  function onDown(e) {
    dragging = true;
    startX = e.clientX;
    startIndex = index;
    wrap.classList.add("dragging");
    wrap.setPointerCapture?.(e.pointerId);
    hint.classList.add("hidden");
  }
  function onMove(e) {
    if (!dragging) return;
    const steps = Math.trunc((e.clientX - startX) / PX_PER_FRAME);
    setIndex(startIndex - steps);
  }
  function onUp() {
    dragging = false;
    wrap.classList.remove("dragging");
  }

  wrap.addEventListener("pointerdown", onDown);
  wrap.addEventListener("pointermove", onMove);
  wrap.addEventListener("pointerup", onUp);
  wrap.addEventListener("pointerleave", onUp);
  wrap.addEventListener("pointercancel", onUp);

  // Preload the rest so dragging through the full turn doesn't stutter.
  for (let i = 1; i < frameUrls.length; i++) {
    const pre = new Image();
    pre.src = "/" + frameUrls[i];
  }

  return wrap;
}

// Minimum saved angles before a spin viewer is worth showing over a plain
// static photo — a couple of frames wouldn't read as a rotation.
const SPIN_MIN_FRAMES = 4;

// Fills popup-media with defaultNode (the video/embed/photo the popup would
// normally show) plus, when enough spin frames exist, a toggle button that
// swaps it for the 360 spin viewer and back — an explicit opt-in rather
// than replacing the default view outright, so a product video still shows
// first even when a spin sequence is also available.
function mountMediaWithSpinToggle(media, { defaultNode, frameUrls, altText }) {
  const frames = frameUrls || [];
  const hasSpin = defaultNode && frames.length >= SPIN_MIN_FRAMES;
  let showingSpin = false;
  let spinNode = null;

  function render() {
    media.replaceChildren();
    if (showingSpin) {
      if (!spinNode) spinNode = buildSpinViewer(frames, altText);
      media.append(spinNode);
    } else if (defaultNode) {
      media.append(defaultNode);
    }
    if (hasSpin) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "spin-toggle-btn";
      btn.textContent = showingSpin ? "🖼 ดูรูปสินค้าปกติ" : "🔄 ดูสินค้าแบบ 3 มิติ";
      btn.onclick = () => {
        if (!showingSpin && defaultNode.tagName === "VIDEO") defaultNode.pause();
        showingSpin = !showingSpin;
        render();
      };
      media.append(btn);
    }
  }
  render();
}
