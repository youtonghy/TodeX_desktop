import { useId, useState } from 'react';
import { RiAddLine, RiCloseLine } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Modal } from '@/components/ui/modal';
import { cx } from '@/utils/cx';
import { WORKSPACE_TAG_MAX, WORKSPACE_TAGS_MAX, normalizeWorkspaceTags } from '@todex/protocol/todex';
import { useT } from '../i18n';

const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring';

/** Edits the tags of a workspace or a workspace group. Enter adds the typed
 * tag; the tags already used elsewhere are offered below for one-click reuse. */
export function WorkspaceTagsDialog({ title, initialTags, knownTags, onSubmit, onClose }: {
  title: string;
  initialTags: string[];
  /** Every tag in use, offered as suggestions. */
  knownTags: string[];
  onSubmit: (tags: string[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const formId = useId();
  const [tags, setTags] = useState(initialTags);
  const [draft, setDraft] = useState('');
  const full = tags.length >= WORKSPACE_TAGS_MAX;
  // A typed tag reuses the spelling of a tag already in use.
  const canonical = (value: string) => knownTags.find((tag) => tag.toLowerCase() === value.trim().toLowerCase()) ?? value;
  const add = (value: string) => {
    const next = normalizeWorkspaceTags([...tags, canonical(value)]) ?? [];
    setTags(next);
    setDraft('');
  };
  const remove = (tag: string) => setTags((current) => current.filter((item) => item !== tag));
  const chosen = new Set(tags.map((tag) => tag.toLowerCase()));
  const needle = draft.trim().toLowerCase();
  const suggestions = knownTags.filter((tag) => !chosen.has(tag.toLowerCase()) && (!needle || tag.toLowerCase().includes(needle)));
  const submit = () => {
    // A tag still typed in the field counts as added.
    onSubmit(draft.trim() ? normalizeWorkspaceTags([...tags, canonical(draft)]) ?? [] : tags);
    onClose();
  };
  return (
    <Modal
      isOpen
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={title}
      size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form={formId}>{t('common.save')}</Button>
        </>
      )}
    >
      <form id={formId} className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <Input
          className="w-full"
          label={t('sidebar.tagsLabel')}
          placeholder={t('sidebar.tagsPlaceholder')}
          hint={full ? t('sidebar.tagsLimit', { n: WORKSPACE_TAGS_MAX }) : undefined}
          value={draft}
          onChange={setDraft}
          autoFocus
          maxLength={WORKSPACE_TAG_MAX}
          isDisabled={full}
          onKeyDown={(event) => {
            // Enter adds the typed tag; an empty field lets Enter save.
            if (event.key === 'Enter' && draft.trim()) {
              event.preventDefault();
              add(draft);
            } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
              remove(tags[tags.length - 1]);
            }
          }}
        />
        {tags.length > 0 ? (
          <ul aria-label={t('sidebar.tagsLabel')} className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <li key={tag}>
                <Chip variant="caption" color="neutral" className="gap-1 pe-1">
                  <bdi>{tag}</bdi>
                  <button
                    type="button"
                    aria-label={t('sidebar.removeTag', { tag })}
                    className={cx('inline-flex size-4 cursor-pointer items-center justify-center rounded-sm text-foreground-icon-tertiary transition-colors duration-150 ease hover:text-foreground-icon-primary', FOCUS_RING)}
                    onClick={() => remove(tag)}
                  >
                    <RiCloseLine aria-hidden className="size-3.5" />
                  </button>
                </Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption-1-regular text-text-tertiary">{t('sidebar.tagsEmpty')}</p>
        )}
        {suggestions.length > 0 && !full ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-caption-1-medium text-text-tertiary">{t('sidebar.tagsSuggestions')}</span>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  aria-label={t('sidebar.addTag', { tag })}
                  className={cx('inline-flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-border-button-default px-1.5 py-0.5 text-caption-1-medium text-text-secondary transition-colors duration-150 ease hover:border-border-button-hover hover:text-text-primary', FOCUS_RING)}
                  onClick={() => add(tag)}
                >
                  <RiAddLine aria-hidden className="size-3" />
                  <bdi>{tag}</bdi>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
