const CANONICAL_HOSTNAME = "searvia.online";

const redirectWorker = {
  async fetch(request: Request): Promise<Response> {
    const destination = new URL(request.url);
    destination.protocol = "https:";
    destination.hostname = CANONICAL_HOSTNAME;
    destination.port = "";

    return Response.redirect(destination.toString(), 301);
  },
};

export default redirectWorker;
