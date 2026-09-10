import { getSession } from "@/lib/session";
import { serverGet } from "@/lib/server-api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatAuditAction } from "@/lib/format";

type AuditEvent = {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export default async function ActivityPage() {
  const me = await getSession();
  const account = me!.account;
  const { events } = await serverGet<{ events: AuditEvent[] }>(
    `/v1/audit?accountId=${account.accountId}`,
  );

  return (
    <div className="dashboard-page space-y-6">
      <div className="dashboard-heading">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Every intent decision and settlement, append-only.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                No activity yet.
              </TableCell>
            </TableRow>
          )}
          {events.map((event) => (
            <TableRow key={event.id}>
              <TableCell className="text-muted-foreground">
                {new Date(event.createdAt).toLocaleString()}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{formatAuditAction(event.action)}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{event.actorType}</TableCell>
              <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground">
                {JSON.stringify(event.payload)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
