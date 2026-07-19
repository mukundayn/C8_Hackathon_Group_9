import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import Dashboard from "./components/hud/Dashboard.tsx";
import LoginPage from "./auth/LoginPage.tsx";

function usePathname(): string {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const updatePathname = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", updatePathname);
    return () => window.removeEventListener("popstate", updatePathname);
  }, []);

  return pathname;
}

function RouteLoading() {
  return <div className="auth-loading" aria-label="Loading authentication" />;
}

export default function AppRouter() {
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useAuth();
  const isLoginRoute = pathname === "/login" || pathname === "/login/sso-callback";

  useEffect(() => {
    if (!isLoaded) return;
    if ((isSignedIn && isLoginRoute) || (!isSignedIn && !isLoginRoute)) {
      window.location.replace(isSignedIn ? "/analyze" : "/login");
    }
  }, [isLoaded, isLoginRoute, isSignedIn]);

  if (!isLoaded) return <RouteLoading />;
  if (isLoginRoute)
    return isSignedIn ? <RouteLoading /> : <LoginPage isCallback={pathname === "/login/sso-callback"} />;
  return isSignedIn ? <Dashboard /> : <RouteLoading />;
}
