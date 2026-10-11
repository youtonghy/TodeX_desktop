import { useState } from 'react';
import type { CatalogScope } from '@todex/protocol/v2';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { Textarea } from '@/components/base/textarea/textarea';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';
import { useT } from '../i18n';

const SKILL_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;
const MCP_TEMPLATE = '{\n  "command": "npx",\n  "args": []\n}';

function skillTemplate(name: string): string {
  return `---\nname: ${name}\ndescription: \n---\n\n`;
}

/** Labels for the skill sources the backend reports, falling back to the raw id. */
export function useSkillSourceLabel() {
  const t = useT();
  return (source: string) => {
    switch (source) {
      case 'shared-user': return t('cap.sourceSharedUser');
      case 'shared-project': return t('cap.sourceSharedProject');
      case 'provider-user': return t('cap.sourceProviderUser');
      case 'provider-project': return t('cap.sourceProviderProject');
      default: return source;
    }
  };
}

export type SkillEditorTarget =
  | { mode: 'create'; sources: string[] }
  | { mode: 'edit'; name: string; content: string };

export function SkillEditorModal({
  target,
  onClose,
  onSubmit,
}: {
  target: SkillEditorTarget | null;
  onClose: () => void;
  onSubmit: (input: { source: string; name: string; content: string }) => Promise<void>;
}) {
  return (
    <Modal
      isOpen={Boolean(target)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      aria-label="Skill"
      size="xl"
      hideCloseButton
    >
      {target ? <SkillEditorForm key={target.mode === 'edit' ? target.name : 'create'} target={target} onClose={onClose} onSubmit={onSubmit} /> : null}
    </Modal>
  );
}

function SkillEditorForm({
  target,
  onClose,
  onSubmit,
}: {
  target: SkillEditorTarget;
  onClose: () => void;
  onSubmit: (input: { source: string; name: string; content: string }) => Promise<void>;
}) {
  const t = useT();
  const sourceLabel = useSkillSourceLabel();
  const creating = target.mode === 'create';
  const [source, setSource] = useState(creating ? target.sources[0] ?? '' : '');
  const [name, setName] = useState(creating ? '' : target.name);
  const [content, setContent] = useState(creating ? skillTemplate('') : target.content);
  const [saving, setSaving] = useState(false);
  const nameInvalid = creating && name.length > 0 && !SKILL_NAME.test(name);
  const contentInvalid = !content.trimStart().startsWith('---');
  const canSave = !saving && !contentInvalid && (!creating || (SKILL_NAME.test(name) && Boolean(source)));

  const save = async () => {
    setSaving(true);
    try {
      await onSubmit({ source, name, content });
      toast.success(t(creating ? 'cap.skillCreated' : 'cap.skillSaved', { name }));
      onClose();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('cap.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-title-3-medium text-text-primary">{creating ? t('cap.newSkill') : t('cap.editSkill', { name })}</h2>
      {creating ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={t('cap.location')}
            selectedKey={source || null}
            onSelectionChange={(key) => setSource(String(key))}
          >
            {target.sources.map((item) => (
              <SelectItem key={item} id={item} textValue={sourceLabel(item)}>{sourceLabel(item)}</SelectItem>
            ))}
          </Select>
          <Input
            label={t('cap.skillName')}
            placeholder="my-skill"
            value={name}
            inputDir="ltr"
            onChange={(next) => {
              // Keep the front matter name in step until the user edits the body.
              if (content === skillTemplate(name)) setContent(skillTemplate(next));
              setName(next);
            }}
            isInvalid={nameInvalid}
            hint={nameInvalid ? t('cap.skillNameHint') : undefined}
          />
        </div>
      ) : null}
      <Textarea
        className="w-full"
        label="SKILL.md"
        value={content}
        onChange={setContent}
        rows={16}
        isInvalid={contentInvalid}
        hint={contentInvalid ? t('cap.frontMatterHint') : undefined}
        inputClassName="font-mono text-caption-1-regular"
      />
      <div className="flex justify-end gap-2.5">
        <Button variant="secondary" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button onClick={save} disabled={!canSave} aria-busy={saving || undefined}>{t('common.save')}</Button>
      </div>
    </div>
  );
}

export type McpEditorTarget =
  | { mode: 'create'; scopes: CatalogScope[] }
  | { mode: 'edit'; name: string; path: string; config: unknown };

export function McpEditorModal({
  target,
  onClose,
  onSubmit,
}: {
  target: McpEditorTarget | null;
  onClose: () => void;
  onSubmit: (input: { scope: CatalogScope; name: string; config: Record<string, unknown> }) => Promise<void>;
}) {
  return (
    <Modal
      isOpen={Boolean(target)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      aria-label="MCP"
      size="xl"
      hideCloseButton
    >
      {target ? <McpEditorForm key={target.mode === 'edit' ? target.name : 'create'} target={target} onClose={onClose} onSubmit={onSubmit} /> : null}
    </Modal>
  );
}

function parseConfig(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function McpEditorForm({
  target,
  onClose,
  onSubmit,
}: {
  target: McpEditorTarget;
  onClose: () => void;
  onSubmit: (input: { scope: CatalogScope; name: string; config: Record<string, unknown> }) => Promise<void>;
}) {
  const t = useT();
  const creating = target.mode === 'create';
  const [scope, setScope] = useState<CatalogScope>(creating ? target.scopes[0] ?? 'user' : 'user');
  const [name, setName] = useState(creating ? '' : target.name);
  const [text, setText] = useState(creating ? MCP_TEMPLATE : JSON.stringify(target.config, null, 2));
  const [saving, setSaving] = useState(false);
  const config = parseConfig(text);
  const canSave = !saving && Boolean(config) && name.trim().length > 0;

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await onSubmit({ scope, name: name.trim(), config });
      toast.success(t(creating ? 'cap.mcpCreated' : 'cap.mcpSaved', { name: name.trim() }));
      onClose();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('cap.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-title-3-medium text-text-primary">{creating ? t('cap.newMcp') : t('cap.editMcp', { name: target.name })}</h2>
        {creating ? null : <p className="truncate text-body-regular text-text-secondary" dir="ltr" title={target.path}>{target.path}</p>}
      </div>
      <div className={creating ? 'grid gap-3 sm:grid-cols-2' : 'flex flex-col'}>
        {creating ? (
          <Select
            label={t('cap.location')}
            selectedKey={scope}
            onSelectionChange={(key) => setScope(key === 'project' ? 'project' : 'user')}
          >
            {target.scopes.map((item) => (
              <SelectItem key={item} id={item} textValue={t(item === 'project' ? 'cap.scopeProject' : 'cap.scopeUser')}>
                {t(item === 'project' ? 'cap.scopeProject' : 'cap.scopeUser')}
              </SelectItem>
            ))}
          </Select>
        ) : null}
        <Input label={t('cap.mcpName')} placeholder="my-server" value={name} onChange={setName} inputDir="ltr" />
      </div>
      <Textarea
        className="w-full"
        label={t('cap.mcpConfigJson')}
        value={text}
        onChange={setText}
        rows={14}
        isInvalid={!config}
        hint={config ? t('cap.mcpConfigHint') : t('cap.mcpConfigInvalid')}
        inputClassName="font-mono text-caption-1-regular"
      />
      <div className="flex justify-end gap-2.5">
        <Button variant="secondary" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button onClick={save} disabled={!canSave} aria-busy={saving || undefined}>{t('common.save')}</Button>
      </div>
    </div>
  );
}
