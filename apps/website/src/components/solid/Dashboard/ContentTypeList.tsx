import type { ContentTypeCount } from "@/utils/analytics";
import CheckSquare from "lucide-solid/icons/check-square";
import GitCommit from "lucide-solid/icons/git-commit-horizontal";
import GitPullRequest from "lucide-solid/icons/git-pull-request";
import MessageSquare from "lucide-solid/icons/message-square";
import Play from "lucide-solid/icons/play";
import Reply from "lucide-solid/icons/reply";
import { For } from "solid-js";

type ContentTypeListProps = {
	types: ContentTypeCount[];
};

const typeIcons: Record<string, typeof GitCommit> = {
	commit: GitCommit,
	pull_request: GitPullRequest,
	post: MessageSquare,
	comment: Reply,
	video: Play,
	task: CheckSquare,
};

const typeLabels: Record<string, string> = {
	commit: "Commits",
	pull_request: "Pull Requests",
	post: "Posts",
	comment: "Comments",
	video: "Videos",
	task: "Tasks",
};

export default function ContentTypeList(props: ContentTypeListProps) {
	return (
		<div class="content-type-list">
			<For each={props.types}>
				{type => {
					const Icon = typeIcons[type.type] ?? MessageSquare;
					const label = typeLabels[type.type] ?? type.type;

					return (
						<div class="content-type-row">
							<div class="content-type-icon">
								<Icon size={16} />
							</div>
							<span class="content-type-name">{label}</span>
							<span class="content-type-count">{type.count}</span>
						</div>
					);
				}}
			</For>
		</div>
	);
}
