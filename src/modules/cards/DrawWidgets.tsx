import { SourceDraw } from "./SourceDraw";

/** The quick tools panel's draw box: choose a set, deck or pool and draw. */
export function QuickDrawWidget() {
  return <SourceDraw showHeading={false} />;
}
