import { NextResponse, type NextRequest } from 'next/server';

/**
 * Rafraîchissement de la session Supabase (jetons en cookies). Sans effet en authentification
 * locale (sessions en base, vérifiées à chaque requête serveur).
 */
export async function middleware(request: NextRequest) {
  const provider = process.env.AUTH_PROVIDER ?? (process.env.NODE_ENV === 'production' ? 'supabase' : 'local');
  if (provider !== 'supabase') return NextResponse.next();
  const { createServerClient } = await import('@supabase/ssr');
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
