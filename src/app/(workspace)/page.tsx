import JDWorkspace from "@/components/jd-workspace";
import { isJdUrlExtractionAvailable } from "@/lib/jd-url-extraction-availability";

export default function Home() {
  return <JDWorkspace pasteFromUrlAvailable={isJdUrlExtractionAvailable()} />;
}
