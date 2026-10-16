// Point d'entrée Cloudflare Worker : sert public/ et route /api/items vers l'API.
import { onRequest } from "../functions/api/items.js";

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/api/items") return onRequest({ request, env });
    return env.ASSETS.fetch(request);
  },
};
