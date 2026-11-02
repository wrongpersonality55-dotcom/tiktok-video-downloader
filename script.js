"use strict";

/* ---------- Config ----------
   By default the site uses the public TikWM API (works straight from the browser).
   To use your own yt-dlp server instead, set MY_API to e.g. "https://your-server.com/api/tiktok"
   It must answer GET ?url=<tiktok link> with JSON:
   { video, hd, audio, images: [], title }  (all fields are direct file URLs)
*/
const CONFIG = {
  MY_API: "",
  TIKWM_API: "https://www.tikwm.com/api/"
};

const TIKTOK = {
  name: "TikTok",
  accent: "#19e3ff",
  icon: '<svg viewBox="0 0 24 24"><path d="M16.6 3h-3.1v12.3a2.6 2.6 0 11-2.6-2.6c.3 0 .5 0 .8.1V9.6a5.8 5.8 0 105.1 5.7V9a7.3 7.3 0 004.2 1.3V7.2A4.3 4.3 0 0116.6 3z"/></svg>'
};

/* ---------- Elements ---------- */
const $ = (id) => document.getElementById(id);
const input = $("urlInput");
const field = $("field");
const badge = $("badge");
const hint = $("hint");
const actions = $("actions");
const clearBtn = $("clearBtn");
const modal = $("modal");
const toast = $("toast");

let current = { url: "", isSlideshow: false, info: null };
let toastTimer;
let lastFocus = null;

/* ---------- Detection ---------- */
function parseTikTok(raw) {
  const value = raw.trim();
  if (!value) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return host === "tiktok.com" || host.endsWith(".tiktok.com") ? u : null;
  } catch {
    return null;
  }
}

// Photo slideshow links contain /photo/<id>. Short links are checked after the API replies.
const isSlideshowUrl = (u) => /\/photo\/\d+/.test(u.pathname);

/* ---------- UI state ---------- */
function setHint(text, kind) {
  hint.textContent = text;
  hint.className = "hint" + (kind ? " " + kind : "");
}

function reset() {
  current = { url: "", isSlideshow: false, info: null };
  field.classList.remove("detected", "invalid");
  badge.className = "badge";
  badge.innerHTML = "";
  actions.hidden = true;
  setHint("", "");
  document.documentElement.style.removeProperty("--accent");
}

function handleInput() {
  const raw = input.value.trim();
  clearBtn.hidden = !raw;
  if (!raw) return reset();

  const u = parseTikTok(raw);
  if (!u) {
    reset();
    field.classList.add("invalid");
    setHint("This is not a TikTok link. Paste a link from TikTok.", "error");
    return;
  }

  const slideshow = isSlideshowUrl(u);
  current = { url: u.href, isSlideshow: slideshow, info: null };

  field.classList.remove("invalid");
  field.classList.add("detected");
  badge.className = "badge tt";
  badge.innerHTML = TIKTOK.icon;
  badge.setAttribute("aria-label", TIKTOK.name);
  document.documentElement.style.setProperty("--accent", TIKTOK.accent);

  setHint(slideshow ? "TikTok photo post detected" : "TikTok link detected", "ok");
  actions.hidden = false;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}

/* ---------- Backend ---------- */
async function fetchInfo(url) {
  if (CONFIG.MY_API) {
    const r = await fetch(CONFIG.MY_API + "?url=" + encodeURIComponent(url));
    if (!r.ok) throw new Error("Server error " + r.status);
    return r.json();
  }
  const r = await fetch(CONFIG.TIKWM_API + "?hd=1&url=" + encodeURIComponent(url));
  if (!r.ok) throw new Error("Server error " + r.status);
  const j = await r.json();
  if (j.code !== 0 || !j.data) throw new Error(j.msg || "Video not found");
  const abs = (p) => (p ? (p.startsWith("http") ? p : "https://www.tikwm.com" + p) : "");
  const d = j.data;
  return {
    title: d.title || "tiktok",
    video: abs(d.play),
    hd: abs(d.hdplay) || abs(d.play),
    audio: abs(d.music),
    images: Array.isArray(d.images) ? d.images : []
  };
}

/* Save a file. Tries a real download first (blob), falls back to opening the file link. */
async function saveFile(fileUrl, filename) {
  try {
    const r = await fetch(fileUrl);
    if (!r.ok) throw new Error("fetch failed");
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch {
    // Browser blocked reading the file (CORS): open it so the user can save it from there
    const a = document.createElement("a");
    a.href = fileUrl;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

const safeName = (t) => (t || "tiktok").replace(/[^\w\-]+/g, "_").slice(0, 40) || "tiktok";

/* downloadVideo(url, type)
   type: "hd" | "mp4" | "mp3" | "images" | "audio" | "video" */
async function downloadVideo(url, type) {
  const info = current.info && current.url === url ? current.info : await fetchInfo(url);
  current.info = info;
  const name = safeName(info.title);

  if (type === "hd" || type === "mp4" || type === "video") {
    const file = type === "hd" ? info.hd : info.video || info.hd;
    if (!file) throw new Error("Video link not available");
    await saveFile(file, name + (type === "hd" ? "_HD.mp4" : ".mp4"));
  } else if (type === "mp3" || type === "audio") {
    if (!info.audio) throw new Error("Audio not available");
    await saveFile(info.audio, name + ".mp3");
  } else if (type === "images") {
    if (!info.images.length) throw new Error("No photos in this post");
    for (let i = 0; i < info.images.length; i++) {
      await saveFile(info.images[i], name + "_" + (i + 1) + ".jpg");
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return info;
}

const LABELS = {
  hd: "HD MP4", mp4: "MP4", mp3: "MP3 audio",
  images: "photos", audio: "audio", video: "slideshow video"
};

function setBusy(on) {
  document.querySelectorAll(".btn").forEach((b) => (b.disabled = on));
}

async function runDownload(type) {
  if (!current.url) return;
  setBusy(true);
  showToast("Preparing " + LABELS[type] + "...");
  try {
    await downloadVideo(current.url, type);
    showToast(LABELS[type] + " download started");
  } catch (err) {
    showToast("Failed: " + (err.message || "try again"));
  } finally {
    setBusy(false);
  }
}

/* ---------- Button click ---------- */
async function onAction(type) {
  // Photo post known from the URL
  if (current.isSlideshow) return openModal();

  // Short links: check what the post is before downloading
  if (!current.info) {
    setBusy(true);
    showToast("Checking link...");
    try {
      current.info = await fetchInfo(current.url);
    } catch (err) {
      setBusy(false);
      return showToast("Failed: " + (err.message || "try again"));
    }
    setBusy(false);
  }
  if (current.info.images && current.info.images.length) {
    current.isSlideshow = true;
    return openModal();
  }
  runDownload(type);
}

/* ---------- Modal ---------- */
function openModal() {
  lastFocus = document.activeElement;
  modal.hidden = false;
  modal.querySelector("[data-slide]").focus();
}
function closeModal() {
  modal.hidden = true;
  if (lastFocus) lastFocus.focus();
}

/* ---------- Events ---------- */
input.addEventListener("input", handleInput);
input.addEventListener("paste", () => setTimeout(handleInput, 0));

clearBtn.addEventListener("click", () => {
  input.value = "";
  clearBtn.hidden = true;
  reset();
  input.focus();
});

actions.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-type]");
  if (btn) onAction(btn.dataset.type);
});

modal.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) return closeModal();
  const opt = e.target.closest("[data-slide]");
  if (opt) {
    closeModal();
    runDownload(opt.dataset.slide);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeModal();
});