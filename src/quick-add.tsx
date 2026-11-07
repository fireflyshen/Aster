import type { LaunchProps } from "@raycast/api";
import { QuickCapture } from "./desktop/quick-capture";
export default function QuickAddTask(
  props: LaunchProps<{ arguments: { expression?: string } }>,
) {
  return <QuickCapture initialExpression={props.arguments?.expression} />;
}
