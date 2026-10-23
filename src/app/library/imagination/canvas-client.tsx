"use client";

import { useRouter } from "next/navigation";
import AchievementImagination from "@/components/achievement-imagination";
import type { ResumeDataSource } from "@/lib/data/loaders";
import type { ResumeLibrary } from "@/lib/schemas/resume-data";

type Props = {
  library: ResumeLibrary;
  source: ResumeDataSource;
};

export default function ImaginationCanvasClient({ library, source }: Props) {
  const router = useRouter();
  const libraryHref = source === "demo" ? "/library?source=demo" : "/library";

  return (
    <AchievementImagination
      allowResume={false}
      library={library}
      onAccept={() => router.refresh()}
      onClose={() => router.push(libraryHref)}
      operation="create"
      source={source}
    />
  );
}
