// Explicitly loaded by live-smoke.mjs. This extension only performs local RPC interactions.
export default function (pi: any) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  pi.on('before_agent_start', () => { throw new Error('Smoke fixture must never invoke a model'); });
  pi.on('session_shutdown', () => { for (const timer of timers) clearTimeout(timer); });
  pi.registerCommand('todex-smoke', {
    description: 'Exercise standard extension UI without invoking a model',
    handler: async (_args: string, ctx: any) => {
      const selected = await ctx.ui.select('Smoke select', ['A', 'B']);
      const confirmed = await ctx.ui.confirm('Smoke confirm', 'Continue smoke test?');
      const input = await ctx.ui.input('Smoke input', 'Type text');
      const editor = await ctx.ui.editor('Smoke editor', 'prefilled\ntext');
      const cancelled = await ctx.ui.input('Smoke cancel', 'Cancel this request');
      ctx.ui.setStatus('smoke', '\u001b[32mReady\u001b[0m');
      ctx.ui.setWidget('smoke-above', ['Above editor', 'Second line']);
      ctx.ui.setWidget('smoke-below', ['Below editor'], { placement: 'belowEditor' });
      ctx.ui.setTitle('Smoke plugin title');
      ctx.ui.setEditorText('Draft from plugin\nsecond line');
      pi.sendMessage({ customType: 'todex-smoke-visible', content: 'Visible custom message', display: true });
      pi.sendMessage({ customType: 'todex-smoke-hidden', content: 'Hidden custom message', display: false });
      let customCalled = false;
      const custom = await ctx.ui.custom(() => { customCalled = true; });
      ctx.ui.notify(JSON.stringify({ marker: 'smoke-results', mode: ctx.mode, hasUI: ctx.hasUI,
        selected, confirmed, input, editor, cancelled: cancelled === undefined,
        customCalled, customUndefined: custom === undefined }));
    },
  });
  pi.registerCommand('todex-background', {
    description: 'Issue UI after the slash command has finished',
    handler: async (_args: string, ctx: any) => {
      const timer = setTimeout(async () => {
        timers.delete(timer);
        ctx.ui.notify('Idle notification');
        ctx.ui.setStatus('smoke', 'Idle update');
        pi.sendMessage({ customType: 'todex-smoke-background', content: 'Idle custom message', display: true });
        const selected = await ctx.ui.select('Smoke idle select', ['A', 'B']);
        ctx.ui.notify(JSON.stringify({ marker: 'smoke-idle-answer', selected, idle: ctx.isIdle() }));
      }, 350);
      timers.add(timer);
    },
  });
  pi.registerCommand('todex-clear', {
    description: 'Clear keyed UI state without adding a chat message',
    handler: async (_args: string, ctx: any) => {
      ctx.ui.setStatus('smoke', undefined);
      ctx.ui.setWidget('smoke-above', undefined);
      ctx.ui.setWidget('smoke-below', undefined);
      ctx.ui.notify('Smoke cleared');
    },
  });
  pi.registerCommand('todex-stop-pending', {
    description: 'Leave an idle input request pending until the runtime is stopped',
    handler: async (_args: string, ctx: any) => {
      const timer = setTimeout(async () => {
        timers.delete(timer);
        await ctx.ui.input('Smoke stop pending', 'The test stops this runtime without replying');
      }, 100);
      timers.add(timer);
    },
  });
}
