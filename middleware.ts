export default function middleware(request: Request) {
  console.log("Next middleware hit for", request.url);
}
