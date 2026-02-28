"use client"

import * as React from "react"
import { Table as RadixTable } from "@radix-ui/themes"

import { cn } from "@/app/lib/utils"

type TableSize = "1" | "2" | "3"
type TableVariant = "surface" | "ghost"
type TableLayout = "auto" | "fixed"

interface TableRootProps
  extends Omit<React.ComponentPropsWithoutRef<typeof RadixTable.Root>, "size" | "variant" | "layout"> {
  size?: TableSize
  variant?: TableVariant
  layout?: TableLayout
  containerClassName?: string
}

interface TableStyleContextValue {
  size: TableSize
  variant: TableVariant
}

const TableStyleContext = React.createContext<TableStyleContextValue>({
  size: "2",
  variant: "surface",
})

const CELL_PADDING_BY_SIZE: Record<TableSize, string> = {
  "1": "px-2 py-1.5 text-xs",
  "2": "px-2 py-2 text-sm",
  "3": "px-3 py-2.5 text-sm md:text-base",
}

const HEADER_PADDING_BY_SIZE: Record<TableSize, string> = {
  "1": "px-2 py-1.5 text-xs",
  "2": "px-2 py-2 text-sm",
  "3": "px-3 py-2.5 text-sm md:text-base",
}

const TableRoot = React.forwardRef<
  React.ElementRef<typeof RadixTable.Root>,
  TableRootProps
>(
  (
    {
      className,
      containerClassName,
      size = "2",
      variant = "surface",
      layout = "auto",
      ...props
    },
    ref
  ) => {
    return (
      <TableStyleContext.Provider value={{ size, variant }}>
        <div
          data-slot="table-container"
          className={cn(
            "relative w-full overflow-x-auto [&_.rt-TableRootTable]:w-full [&_.rt-TableRootTable]:min-w-full",
            containerClassName
          )}
        >
          <RadixTable.Root
            ref={ref}
            data-slot="table"
            size={size}
            variant={variant}
            layout={layout}
            className={cn(
              "w-full caption-bottom",
              layout === "fixed" && "table-fixed",
              className
            )}
            {...props}
          />
        </div>
      </TableStyleContext.Provider>
    )
  }
)
TableRoot.displayName = "Table.Root"

const TableHeader = React.forwardRef<
  React.ElementRef<typeof RadixTable.Header>,
  React.ComponentPropsWithoutRef<typeof RadixTable.Header>
>(({ className, ...props }, ref) => {
  const { variant } = React.useContext(TableStyleContext)

  return (
    <RadixTable.Header
      ref={ref}
      data-slot="table-header"
      className={cn(
        variant === "surface" && "[&_tr]:border-b [&_th]:bg-muted/40",
        className
      )}
      {...props}
    />
  )
})
TableHeader.displayName = "Table.Header"

const TableBody = React.forwardRef<
  React.ElementRef<typeof RadixTable.Body>,
  React.ComponentPropsWithoutRef<typeof RadixTable.Body>
>(({ className, ...props }, ref) => {
  return (
    <RadixTable.Body
      ref={ref}
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
})
TableBody.displayName = "Table.Body"

const TableFooter = React.forwardRef<
  React.ElementRef<"tfoot">,
  React.ComponentPropsWithoutRef<"tfoot">
>(({ className, ...props }, ref) => {
  return (
    <tfoot
      ref={ref}
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
})
TableFooter.displayName = "Table.Footer"

const TableRow = React.forwardRef<
  React.ElementRef<typeof RadixTable.Row>,
  React.ComponentPropsWithoutRef<typeof RadixTable.Row>
>(({ className, ...props }, ref) => {
  const { variant } = React.useContext(TableStyleContext)

  return (
    <RadixTable.Row
      ref={ref}
      data-slot="table-row"
      className={cn(
        variant === "surface" ? "border-b hover:bg-muted/50" : "hover:bg-muted/40",
        "data-[state=selected]:bg-muted transition-colors",
        className
      )}
      {...props}
    />
  )
})
TableRow.displayName = "Table.Row"

const TableCell = React.forwardRef<
  React.ElementRef<typeof RadixTable.Cell>,
  React.ComponentPropsWithoutRef<typeof RadixTable.Cell>
>(({ className, ...props }, ref) => {
  const { size } = React.useContext(TableStyleContext)

  return (
    <RadixTable.Cell
      ref={ref}
      data-slot="table-cell"
      className={cn(
        "align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        CELL_PADDING_BY_SIZE[size],
        className
      )}
      {...props}
    />
  )
})
TableCell.displayName = "Table.Cell"

const TableColumnHeaderCell = React.forwardRef<
  React.ElementRef<typeof RadixTable.ColumnHeaderCell>,
  React.ComponentPropsWithoutRef<typeof RadixTable.ColumnHeaderCell>
>(({ className, ...props }, ref) => {
  const { size } = React.useContext(TableStyleContext)

  return (
    <RadixTable.ColumnHeaderCell
      ref={ref}
      data-slot="table-column-header-cell"
      className={cn(
        "text-foreground text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        HEADER_PADDING_BY_SIZE[size],
        className
      )}
      {...props}
    />
  )
})
TableColumnHeaderCell.displayName = "Table.ColumnHeaderCell"

const TableRowHeaderCell = React.forwardRef<
  React.ElementRef<typeof RadixTable.RowHeaderCell>,
  React.ComponentPropsWithoutRef<typeof RadixTable.RowHeaderCell>
>(({ className, ...props }, ref) => {
  const { size } = React.useContext(TableStyleContext)

  return (
    <RadixTable.RowHeaderCell
      ref={ref}
      data-slot="table-row-header-cell"
      className={cn(
        "text-foreground text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        HEADER_PADDING_BY_SIZE[size],
        className
      )}
      {...props}
    />
  )
})
TableRowHeaderCell.displayName = "Table.RowHeaderCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.ComponentPropsWithoutRef<"caption">
>(({ className, ...props }, ref) => {
  return (
    <caption
      ref={ref}
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
})
TableCaption.displayName = "Table.Caption"

const Table = Object.assign(TableRoot, {
  Root: TableRoot,
  Header: TableHeader,
  Body: TableBody,
  Footer: TableFooter,
  Row: TableRow,
  Cell: TableCell,
  ColumnHeaderCell: TableColumnHeaderCell,
  RowHeaderCell: TableRowHeaderCell,
  Caption: TableCaption,
})

const TableHead = TableColumnHeaderCell

export {
  Table,
  TableRoot,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableColumnHeaderCell,
  TableRowHeaderCell,
  TableCaption,
}
