import { UserShell } from "@/components/layout/user-shell";

export default function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <UserShell>{children}</UserShell>;
}
