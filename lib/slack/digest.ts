import { PlannerSnapshot } from '@/lib/domain/types';
import { DAY_END_HOUR, DAY_START_HOUR, pad2 } from '@/lib/domain/time';

type DigestItem = {
  taskTitle: string;
  jiraKey?: string;
  jiraUrl?: string;
  startHour: number;
  durationHours: number;
};

export type DailyDigest = {
  date: string;
  employeeName: string;
  totalHours: number;
  overload: boolean;
  items: DigestItem[];
};

export function buildDailyDigest(snapshot: PlannerSnapshot, date: string): DailyDigest[] {
  const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const employeeById = new Map(snapshot.employees.map((employee) => [employee.id, employee]));
  const result: DailyDigest[] = [];

  snapshot.employees.forEach((employee) => {
    const items = snapshot.assignments
      .filter((assignment) => assignment.employeeId === employee.id && assignment.startDate === date)
      .map((assignment) => {
        const task = taskById.get(assignment.taskId);
        return {
          taskTitle: task?.title ?? 'Task',
          jiraKey: task?.jiraKey,
          jiraUrl: task?.url,
          startHour: assignment.startHour,
          durationHours: assignment.durationHours
        };
      })
      .sort((a, b) => a.startHour - b.startHour || a.taskTitle.localeCompare(b.taskTitle));

    const totalHours = items.reduce((sum, item) => sum + item.durationHours, 0);
    result.push({
      date,
      employeeName: employeeById.get(employee.id)?.name ?? employee.name,
      totalHours,
      overload: totalHours > DAY_END_HOUR - DAY_START_HOUR,
      items
    });
  });

  return result;
}

export function formatDigestAsSlackMarkdown(digest: DailyDigest): string {
  const header = `*Plan na ${digest.date}* — ${digest.employeeName}\nSuma: *${digest.totalHours}h*`;
  if (!digest.items.length) return `${header}\nBrak zaplanowanych tasków.`;
  const lines = digest.items.map((item) => {
    const time = `${pad2(item.startHour)}:00-${pad2(item.startHour + item.durationHours)}:00`;
    const jira = item.jiraKey ? ` (${item.jiraKey})` : '';
    return `• ${time} — ${item.taskTitle}${jira}`;
  });
  return `${header}\n${lines.join('\n')}`;
}
