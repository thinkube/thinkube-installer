/**
 * Ansible Log Utilities
 *
 * Provides semantic coloring for Ansible playbook execution logs.
 * Uses theme colors for automatic light/dark mode support.
 *
 * Note: This is NOT for code syntax highlighting - use a syntax highlighter
 * library (like Shiki or Prism) for that purpose.
 */

export type AnsibleLogType =
  | 'task'      // Task execution
  | 'play'      // Play header
  | 'ok'        // Success
  | 'changed'   // Changed state
  | 'skipped'   // Skipped task
  | 'failed'    // Failed task
  | 'error'     // Error message
  | 'start'     // Playbook start
  | 'complete'  // Playbook complete
  | 'output'    // General output
  | 'default';  // Regular output

/**
 * Get the CSS class for an Ansible log type
 * Uses theme semantic colors (primary, success, warning, destructive)
 */
export function getAnsibleLogClassName(type: AnsibleLogType): string {
  switch (type) {
    case 'task':
      return 'text-info font-semibold';
    case 'play':
      return 'text-primary font-semibold';
    case 'ok':
      return 'text-success';
    case 'changed':
      return 'text-warning';
    case 'skipped':
      return 'text-muted-foreground opacity-60';
    case 'failed':
      return 'text-destructive';
    case 'error':
      return 'text-destructive font-semibold';
    case 'start':
    case 'complete':
      return 'text-primary font-semibold';
    default:
      return 'text-foreground';
  }
}

/**
 * Get the prefix symbol for an Ansible log type
 * These symbols appear before each log line
 */
export function getAnsibleLogPrefix(type: AnsibleLogType): string {
  switch (type) {
    case 'task':
      return '>';
    case 'play':
      return '#';
    case 'ok':
      return '✓';
    case 'changed':
      return '~';
    case 'skipped':
      return '○';
    case 'failed':
      return '✗';
    case 'error':
      return '!';
    case 'start':
      return '▶';
    case 'complete':
      return '■';
    default:
      return '$';
  }
}

/**
 * Example usage:
 *
 * import { getAnsibleLogClassName, getAnsibleLogPrefix } from '@/lib/ansible-log-utils';
 *
 * <div className="max-h-96 overflow-y-auto p-4 bg-muted/30 rounded-lg font-mono text-sm">
 *   {logs.map((log, idx) => (
 *     <div key={idx} className={getAnsibleLogClassName(log.type)}>
 *       <span className="text-muted-foreground">{getAnsibleLogPrefix(log.type)} </span>
 *       {log.message}
 *     </div>
 *   ))}
 * </div>
 */
