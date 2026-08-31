import { Input, Label, TextField } from '@heroui/react';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  description?: string;
};

export function Field({ label, value, onChange, type = 'text', description }: Props) {
  return (
    <TextField className="w-full" name={label} type={type} value={value} onChange={onChange}>
      <Label>{label}</Label>
      <Input className="w-full" />
      {description ? <p className="text-muted mt-1 text-xs">{description}</p> : null}
    </TextField>
  );
}
