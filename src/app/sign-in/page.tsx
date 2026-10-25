import { redirect } from "next/navigation";
import SignIn from "@/components/sign-in";
import { getAppMode } from "@/lib/cloud/security";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  if (getAppMode() === "local") redirect("/");
  return <SignIn />;
}
