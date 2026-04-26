import { DashboardExperience } from "@/components/dashboard-experience";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return <DashboardExperience projectSlug={slug} />;
}
