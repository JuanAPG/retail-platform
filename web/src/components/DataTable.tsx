export interface DataTableColumn<T> {
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
}

export function DataTable<T>({ columns, rows, rowKey }: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-card border-2 border-arena">
      <table className="w-full text-left text-sm">
        <thead className="bg-arena text-xs font-bold uppercase tracking-wide text-teal">
          <tr>
            {columns.map((col) => (
              <th key={col.header} className="px-4 py-3">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-salvia/20">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="transition hover:bg-arena/40">
              {columns.map((col) => (
                <td key={col.header} className={`px-4 py-3 text-tinta ${col.className ?? ''}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
