import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "soundspa_session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // защищаем только /app и всё, что под ним
  if (pathname.startsWith("/app")) {
    const session = request.cookies.get(SESSION_COOKIE)?.value;
    
    if (!session) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};