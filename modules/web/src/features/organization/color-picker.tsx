import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { colors, type Color } from "@core/workspace/organization";

export function ColorPicker({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: Color;
  disabled?: boolean;
  onChange: (color: Color) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(color) => onChange(color as Color)}
    >
      <SelectTrigger
        id={id}
        className="h-10 w-full text-base data-[size=default]:h-10 md:text-sm md:data-[size=default]:h-8"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        position="popper"
        className="max-h-[min(18.375rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] md:max-h-[min(18.875rem,var(--radix-select-content-available-height))]"
      >
        {colors.map((color) => (
          <SelectItem
            key={color.id}
            value={color.id}
            className="min-h-10 pl-10 pr-3 text-base md:min-h-8 md:py-1 md:text-sm [&>[data-slot=select-item-indicator]]:left-3 [&>[data-slot=select-item-indicator]]:right-auto"
          >
            <span
              className="size-3.5 shrink-0 rounded-full md:size-3"
              style={{ background: color.value }}
            />
            {color.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
