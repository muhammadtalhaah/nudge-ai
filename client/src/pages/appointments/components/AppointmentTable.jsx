/**
 * Desktop / tablet view of appointments.
 *
 * The company standard calls for a table here and a card list on mobile; the two are separate
 * presentational components fed by one hook, so there is no duplicated fetching.
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import AppStatusBadge from '@/components/shared/AppStatusBadge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/utils/formatDate';

const isCancellable = (status) => status === 'CONFIRMED' || status === 'PENDING';

const AppointmentTable = ({ appointments, onCancel, cancellingId }) => {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Doctor</TableHead>
          <TableHead>Specialty</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Booked via</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {appointments.map((appointment) => (
          // Stable database id as the key, never an array index.
          <TableRow key={appointment.id}>
            <TableCell className="font-medium whitespace-nowrap">
              {formatDateTime(appointment.startsAt)}
            </TableCell>
            <TableCell>{appointment.providerName}</TableCell>
            <TableCell className="text-muted-foreground">{appointment.providerSpecialty}</TableCell>
            <TableCell>
              <AppStatusBadge status={appointment.status} />
            </TableCell>
            <TableCell className="text-muted-foreground capitalize">{appointment.source}</TableCell>
            <TableCell className="text-right">
              {isCancellable(appointment.status) ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCancel(appointment)}
                  disabled={cancellingId === appointment.id}
                  // Names the specific appointment, so a screen reader user knows which of
                  // several identical "Cancel" buttons they are on.
                  aria-label={`Cancel appointment with ${appointment.providerName} on ${formatDateTime(appointment.startsAt)}`}
                >
                  {cancellingId === appointment.id ? 'Cancelling' : 'Cancel'}
                </Button>
              ) : (
                <span className="text-muted-foreground text-sm">—</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export default AppointmentTable;
