import { Input } from '@/components/base/input/input';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  description?: string;
};

export function Field({ label, value, onChange, type = 'text', description }: Props) {
  return <Input className="w-full" name={label} type={type} label={label} value={value} onChange={onChange} hint={description} />;
}
