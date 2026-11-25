import { createRouteHandler, createUploadthing, UploadThingError } from "uploadthing/server";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function firebaseIdToken(request) {
  const [, idToken] = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i) ?? [];
  return idToken ?? "";
}

async function verifiedFirebaseUser(idToken, apiKey) {
  if (!idToken || !apiKey) return null;
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) return null;
  const user = (await response.json()).users?.[0];
  return user?.localId && !user.disabled ? user : null;
}

async function getUserProfile(env, idToken, userId) {
  const projectId = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const path = ["users", userId].map(encodeURIComponent).join("/");
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The Firebase account could not be checked.");
  const document = await response.json();
  return Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, value.stringValue ?? null]));
}

function createUploadRouter(env) {
  const upload = createUploadthing();
  return {
    productImage: upload({ image: { maxFileSize: "8MB", maxFileCount: 1 } })
      .middleware(async ({ req, files }) => {
        const idToken = firebaseIdToken(req);
        const user = await verifiedFirebaseUser(idToken, env.FIREBASE_API_KEY);
        if (!user) throw new UploadThingError("Sign in with a valid CKB Lechon account to upload a product image.");
        if (files.length !== 1 || !allowedImageTypes.has(files[0].type)) {
          throw new UploadThingError("Choose a JPEG, PNG, or WebP image up to 8 MB.");
        }
        const profile = await getUserProfile(env, idToken, user.localId);
        if (profile?.role !== "admin") throw new UploadThingError("Only CKB Lechon admins can upload product images.");
        return { userId: user.localId };
      })
      .onUploadComplete(async ({ file }) => ({ imageUrl: file.ufsUrl, fileKey: file.key })),
  };
}

async function handleUploadThing(request, env, context, url) {
  const handlers = createRouteHandler({
    router: createUploadRouter(env),
    config: {
      token: env.UPLOADTHING_TOKEN,
      isDev: env.ENVIRONMENT === "development" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      fetch: (target, init) => {
        if (init && "cache" in init) delete init.cache;
        return fetch(target, init);
      },
      handleDaemonPromise: (promise) => context.waitUntil(promise),
    },
  });
  return handlers[request.method](request);
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin") ?? "";
  const allowed = new Set([env.CKB_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000"]);
  const localOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin);
  if (allowed.has(origin) || localOrigin) headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", request.headers.get("access-control-request-headers") || "authorization, content-type");
  headers.set("access-control-max-age", "86400");
  headers.append("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const worker = {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/uploadthing") {
      return withCors(Response.json({ message: "Upload route not found. Use /api/uploadthing." }, { status: 404 }), request, env);
    }
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), request, env);
    if (request.method !== "GET" && request.method !== "POST") {
      return withCors(Response.json({ message: "Method not allowed." }, { status: 405 }), request, env);
    }
    const missingSecrets = ["UPLOADTHING_TOKEN", "FIREBASE_API_KEY"].filter((name) => !env[name]);
    if (missingSecrets.length > 0) {
      return withCors(Response.json({ message: `The upload Worker is missing the ${missingSecrets.join(" and ")} secret${missingSecrets.length === 1 ? "" : "s"}.` }, { status: 500 }), request, env);
    }
    try {
      const response = await handleUploadThing(request, env, context, url);
      return withCors(response, request, env);
    } catch (error) {
      console.error(error);
      return withCors(Response.json({ message: "The upload Worker failed. Check its Cloudflare logs for details." }, { status: 500 }), request, env);
    }
  },
};

export default worker;
