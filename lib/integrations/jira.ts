export interface JiraIssue {
  issueId: string;
  key: string;
  title: string;
  url: string;
  status?: string;
  assigneeEmail?: string;
  epic?: {
    key: string;
    name: string;
    color: string;
  };
}

const fallbackIssues: JiraIssue[] = [
  {
    issueId: 'jira-201',
    key: 'MV-201',
    title: 'ACM',
    url: 'https://jira.example.local/browse/MV-201',
    status: 'To Do',
    epic: { key: 'EP-1', name: 'kreatywka', color: '#4A7FF8' }
  },
  {
    issueId: 'jira-202',
    key: 'MV-202',
    title: 'Branding: finalowe spotkanie feedbackowe',
    url: 'https://jira.example.local/browse/MV-202',
    status: 'In Progress',
    epic: { key: 'EP-3', name: 'branding', color: '#FF7648' }
  },
  {
    issueId: 'jira-204',
    key: 'MV-204',
    title: 'Eventy - branding przestrzeni',
    url: 'https://jira.example.local/browse/MV-204',
    status: 'To Do',
    epic: { key: 'EP-2', name: 'eventy', color: '#FFC757' }
  }
];

function hasJiraConfig(): boolean {
  return Boolean(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN);
}

function authHeader(): string {
  const basic = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
  return `Basic ${basic}`;
}

export async function fetchJiraIssues(jql: string): Promise<JiraIssue[]> {
  if (!hasJiraConfig()) {
    return fallbackIssues;
  }

  const base = process.env.JIRA_BASE_URL!;
  const url = `${base.replace(/\/$/, '')}/rest/api/3/search/jql`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jql,
      maxResults: 100,
      fields: ['summary', 'status', 'assignee', 'parent', 'labels', 'customfield_10014']
    }),
    cache: 'no-store'
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jira API error: ${response.status}. ${body}`);
  }

  const payload = (await response.json()) as {
    issues?: Array<{
      id: string;
      key: string;
      fields?: {
        summary?: string;
        status?: { name?: string };
        assignee?: { emailAddress?: string };
        parent?: { key?: string; fields?: { summary?: string } };
        customfield_10014?: string;
      };
    }>;
  };

  return (payload.issues ?? []).map((issue) => {
    const epicKey = issue.fields?.customfield_10014 ?? issue.fields?.parent?.key;
    const epicName = issue.fields?.parent?.fields?.summary ?? 'jira';
    const epicColor = '#4A7FF8';
    return {
      issueId: issue.id,
      key: issue.key,
      title: issue.fields?.summary ?? issue.key,
      url: `${base.replace(/\/$/, '')}/browse/${issue.key}`,
      status: issue.fields?.status?.name,
      assigneeEmail: issue.fields?.assignee?.emailAddress,
      epic: epicKey
        ? {
            key: epicKey,
            name: epicName,
            color: epicColor
          }
        : undefined
    };
  });
}
