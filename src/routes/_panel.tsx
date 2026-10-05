import { createFileRoute, redirect } from "@tanstack/react-router";
import { RedirectToSignIn } from "@/auth/gates";
import { useCurrentUserState } from "@/auth/use-current-user";
import { Shell } from "@/components/layout/shell";
import { sessionUser } from "@/auth/api";
import { getPanelState } from "@/features/settings/api";

export const Route = createFileRoute("/_panel")({
  loader: async () => {
    const user = await sessionUser();
    if (!user) {
      throw redirect({ to: "/login" });
    }
    return getPanelState();
  },
  component: PanelLayout,
});

function PanelLayout() {
  const data = Route.useLoaderData();
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return <div className="min-h-dvh bg-background" />;
  }
  if (!user) return <RedirectToSignIn />;
  return <Shell settings={data.settings} modules={data.modules} />;
}
