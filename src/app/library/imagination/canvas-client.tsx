"use client";

import { useRouter } from "next/navigation";
import ImaginationCanvas from "@/components/imagination-canvas";
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
    <ImaginationCanvas
      library={library}
      onClose={() => router.push(libraryHref)}
      source={source}
    />
  );
}
