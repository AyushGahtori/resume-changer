import { GithubImportComponentPlaceholder } from "./testing/placeholder";
import type {
  EvidenceChipProps,
  ImportButtonProps,
  ImportInfoBannerProps,
  ImportStatusPillProps,
} from "../../lib/github/contracts";

export function ImportButton(_props: ImportButtonProps) {
  return <GithubImportComponentPlaceholder name="ImportButton" />;
}

export function ImportStatusPill(_props: ImportStatusPillProps) {
  return <GithubImportComponentPlaceholder name="ImportStatusPill" />;
}

export function ImportInfoBanner(_props: ImportInfoBannerProps) {
  return <GithubImportComponentPlaceholder name="ImportInfoBanner" />;
}

export function EvidenceChip(_props: EvidenceChipProps) {
  return <GithubImportComponentPlaceholder name="EvidenceChip" />;
}
