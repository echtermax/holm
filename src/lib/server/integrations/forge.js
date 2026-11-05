// What GitHub and Gitea rows share: the icon says repo, issue or PR, and its
// colour says the state, so the row reads at a glance without a type word.

// GitHub's own state colours: open green, merged purple, closed red.
export const STATE_COLORS = { Open: '#3fb950', Merged: '#a371f7', Closed: '#f85149' };

export function issueKind(pr, status) {
	if (!pr) return status === 'Closed' ? 'issue-closed' : 'issue';
	return status === 'Merged' ? 'pr-merged' : status === 'Closed' ? 'pr-closed' : 'pr';
}
