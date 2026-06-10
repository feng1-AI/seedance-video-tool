const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { exec } = require("child_process");

const HOST = "127.0.0.1";
const PORT = Number(process.env.SEEDANCE_PORT || 8787);
const API_KEY = process.env.SEEDANCE_API_KEY || "";
const MODEL = process.env.SEEDANCE_MODEL || "doubao-seedance-2-0-260128";
const ARK_BASE_URL = process.env.SEEDANCE_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const WORKDIR = __dirname;
const TASK_RESPONSE_FILE = path.join(WORKDIR, "seedance_task_response.json");
const TASK_STATUS_FILE = path.join(WORKDIR, "seedance_task_status.json");
const LAST_ERROR_FILE = path.join(WORKDIR, "seedance_last_error.json");
const VIDEO_DIR = path.join(WORKDIR, "AI视频测试");
const TASK_NAMES = new Map();
const SAVED_VIDEOS = new Map();

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "File not found" });
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) return { fields: {}, files: [] };

  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const body = buffer.toString("binary");
  const parts = body.split(boundary).slice(1, -1);
  const fields = {};
  const files = [];

  for (const part of parts) {
    const trimmed = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const headerEnd = trimmed.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const rawHeaders = trimmed.slice(0, headerEnd);
    const rawContent = trimmed.slice(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/i.exec(rawHeaders);
    if (!nameMatch) continue;

    const filenameMatch = /filename="([^"]*)"/i.exec(rawHeaders);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(rawHeaders);
    const name = nameMatch[1];
    const content = Buffer.from(rawContent, "binary");

    if (filenameMatch && filenameMatch[1]) {
      files.push({
        field: name,
        filename: filenameMatch[1],
        contentType: typeMatch ? typeMatch[1].trim() : "application/octet-stream",
        buffer: content
      });
    } else {
      fields[name] = content.toString("utf8");
    }
  }

  return { fields, files };
}

function buildSeedancePayload(fields, files) {
  const prompt = fields.prompt || "";
  const content = [{ type: "text", text: prompt }];

  for (const file of files) {
    if (!file.contentType.startsWith("image/")) continue;
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${file.contentType};base64,${file.buffer.toString("base64")}`
      },
      role: "reference_image"
    });
  }

  return {
    model: MODEL,
    content,
    ratio: fields.ratio || "3:4",
    duration: Number(fields.duration || 15),
    resolution: "720p",
    generate_audio: true
  };
}

async function createSeedanceTask(fields, files) {
  if (!API_KEY) {
    const error = new Error("SEEDANCE_API_KEY is not set");
    error.status = 500;
    throw error;
  }

  const payload = buildSeedancePayload(fields, files);
  const response = await fetch(`${ARK_BASE_URL}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(data.error?.message || data.message || `Seedance API error ${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  fs.writeFileSync(TASK_RESPONSE_FILE, JSON.stringify(data, null, 2), "utf8");
  return data;
}

async function getSeedanceStatus(id) {
  if (!API_KEY) {
    const error = new Error("SEEDANCE_API_KEY is not set");
    error.status = 500;
    throw error;
  }

  const response = await fetch(`${ARK_BASE_URL}/contents/generations/tasks/${encodeURIComponent(id)}`, {
    headers: { "Authorization": `Bearer ${API_KEY}` }
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(data.error?.message || data.message || `Seedance API error ${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  fs.writeFileSync(TASK_STATUS_FILE, JSON.stringify(data, null, 2), "utf8");
  return data;
}

function extractTaskId(data) {
  return data.id || data.task_id || data.data?.id || data.data?.task_id || randomUUID();
}

function extractVideoUrl(data) {
  return data.content?.video_url || data.video_url || data.data?.content?.video_url || data.data?.video_url || "";
}

function safeFilename(value) {
  return String(value || "seedance-video")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .slice(0, 120);
}

async function downloadVideo(videoUrl, taskId, preferredName) {
  if (!videoUrl) return null;

  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  if (SAVED_VIDEOS.has(taskId)) {
    const saved = SAVED_VIDEOS.get(taskId);
    if (fs.existsSync(saved.filePath)) return saved;
  }

  const baseName = safeFilename(preferredName || taskId);
  let filename = `${baseName}.mp4`;
  let filePath = path.join(VIDEO_DIR, filename);
  let copy = 2;

  while (fs.existsSync(filePath) && fs.statSync(filePath).size > 0 && preferredName) {
    filename = `${baseName}_${copy}.mp4`;
    filePath = path.join(VIDEO_DIR, filename);
    copy += 1;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return { filename, filePath };
  }

  const response = await fetch(videoUrl);
  if (!response.ok) {
    const error = new Error(`Video download failed ${response.status}`);
    error.status = 502;
    throw error;
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
  const saved = { filename, filePath };
  SAVED_VIDEOS.set(taskId, saved);
  return saved;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/seedance_prompt_tool.html")) {
      sendFile(res, path.join(WORKDIR, "seedance_prompt_tool.html"));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/seedance/generate") {
      const body = await readBody(req);
      const { fields, files } = parseMultipart(body, req.headers["content-type"]);
      const data = await createSeedanceTask(fields, files);
      const taskId = extractTaskId(data);
      if (fields.videoName) {
        TASK_NAMES.set(taskId, fields.videoName);
      }
      sendJson(res, 200, {
        ok: true,
        taskId,
        raw: data
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/seedance/status") {
      const id = url.searchParams.get("id");
      if (!id) {
        sendJson(res, 400, { error: "Missing task id" });
        return;
      }
      const data = await getSeedanceStatus(id);
      const videoUrl = extractVideoUrl(data);
      const savedVideo = videoUrl ? await downloadVideo(videoUrl, id, TASK_NAMES.get(id)) : null;
      sendJson(res, 200, {
        ok: true,
        taskId: extractTaskId(data),
        status: data.status || data.data?.status,
        videoUrl,
        savedPath: savedVideo?.filePath || "",
        localVideoUrl: savedVideo ? `/api/seedance/video?file=${encodeURIComponent(savedVideo.filename)}` : "",
        raw: data
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/seedance/video") {
      const filename = path.basename(url.searchParams.get("file") || "");
      if (!filename) {
        sendJson(res, 400, { error: "Missing video filename" });
        return;
      }
      const filePath = path.join(VIDEO_DIR, filename);
      fs.readFile(filePath, (error, data) => {
        if (error) {
          sendJson(res, 404, { error: "Video not found" });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "video/mp4",
          "Content-Disposition": `attachment; filename="${filename}"`
        });
        res.end(data);
      });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    fs.writeFileSync(LAST_ERROR_FILE, JSON.stringify({
      time: new Date().toISOString(),
      path: url.pathname,
      status: error.status || 500,
      error: error.message,
      details: error.details
    }, null, 2), "utf8");
    sendJson(res, error.status || 500, {
      error: error.message,
      details: error.details
    });
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/seedance_prompt_tool.html`;
  console.log(`Seedance tool running at ${url}`);
  console.log(API_KEY ? "SEEDANCE_API_KEY is set" : "SEEDANCE_API_KEY is missing");
  exec(`start "" "${url}"`);
});
