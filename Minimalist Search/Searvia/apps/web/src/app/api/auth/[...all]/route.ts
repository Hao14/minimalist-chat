import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";

const handlers = toNextJsHandler((request) => getAuth().handler(request));

export const { GET, POST } = handlers;
