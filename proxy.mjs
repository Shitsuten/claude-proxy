#!/usr/bin/env node
// Claude -p Proxy — Anthropic API compatible endpoint backed by Claude Code CLI
// Accepts POST /v1/messages in Anthropic format, spawns claude -p, returns SSE stream

import { createServer } from 'http';
import { spawn } from 'child_process';

const PORT = parseInt(process.env.PROXY_PORT || '8792');
const AUTH_TOKEN = process.env.PROXY_AUTH_TOKEN || '';
const CLAUDE_CWD = process.env.CLAUDE_CWD || '/opt/butter-web';

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => res(Buffer.concat(chunks).toString())); req.on('error', rej);
  });
}

function messagesToPrompt(body) {
  let prompt = '';
  if (body.system) {
    const sys = typeof body.system === 'string' ? body.system : body.system.map(b => b.text || '').join('\n');
    prompt += `<system>${sys}</system>\n\n`;
  }
  for (const msg of body.messages || []) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        prompt += `Human: ${msg.content}\n\n`;
      } else if (Array.isArray(msg.content)) {
        const texts = msg.content.filter(b => b.type === 'text').map(b => b.text);
        if (texts.length) prompt += `Human: ${texts.join('\n')}\n\n`;
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        prompt += `Assistant: ${msg.content}\n\n`;
      } else if (Array.isArray(msg.content)) {
        const texts = msg.content.filter(b => b.type === 'text').map(b => b.text);
        if (texts.length) prompt += `Assistant: ${texts.join('\n')}\n\n`;
      }
    }
  }
  return prompt;
}

const server = createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  if (req.url === '/v1/messages' && req.method === 'POST') {
    if (AUTH_TOKEN) {
      const auth = req.headers['x-api-key'] || req.headers.authorization?.replace('Bearer ', '');
      if (auth !== AUTH_TOKEN) { res.writeHead(401, cors); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    }

    const body = JSON.parse(await readBody(req));
    const prompt = messagesToPrompt(body);
    const isStream = body.stream !== false;
    const model = body.model || '';

    const noTools = body.tools === undefined || body.tools === null || (Array.isArray(body.tools) && body.tools.length === 0);
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--include-partial-messages'];
    if (noTools) args.push('--tools', 'none');
    if (body.system) {
      const sysText = typeof body.system === 'string' ? body.system : body.system.map(b => b.text || '').join('\n');
      if (sysText) args.push('--system-prompt', sysText);
    }
    if (model && model !== 'claude-sonnet-4-6') args.push('--model', model);

    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: CLAUDE_CWD });
    child.stdin.write(prompt);
    child.stdin.end();

    if (isStream) {
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });

      let msgId = `msg_proxy_${Date.now()}`;
      let blockIdx = 0;
      let buf = '';

      res.write(`event: message_start\ndata: ${JSON.stringify({type:"message_start",message:{id:msgId,type:"message",role:"assistant",content:[],model:model||"claude-opus-4-6",stop_reason:null,usage:{input_tokens:0,output_tokens:0}}})}\n\n`);

      child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'stream_event') {
              const se = ev.event || {};
              if (se.type === 'content_block_start') {
                const cb = se.content_block || {};
                res.write(`event: content_block_start\ndata: ${JSON.stringify({type:"content_block_start",index:blockIdx,content_block:{type:cb.type,text:cb.type==='text'?'':undefined,thinking:cb.type==='thinking'?'':undefined}})}\n\n`);
              } else if (se.type === 'content_block_delta') {
                const d = se.delta || {};
                res.write(`event: content_block_delta\ndata: ${JSON.stringify({type:"content_block_delta",index:blockIdx,delta:d})}\n\n`);
              } else if (se.type === 'content_block_stop') {
                res.write(`event: content_block_stop\ndata: ${JSON.stringify({type:"content_block_stop",index:blockIdx})}\n\n`);
                blockIdx++;
              }
            } else if (ev.type === 'result') {
              res.write(`event: message_delta\ndata: ${JSON.stringify({type:"message_delta",delta:{stop_reason:ev.stop_reason||"end_turn"},usage:{output_tokens:ev.usage?.output_tokens||0}})}\n\n`);
              res.write(`event: message_stop\ndata: ${JSON.stringify({type:"message_stop"})}\n\n`);
            }
          } catch {}
        }
      });

      child.stderr.on('data', () => {});
      child.on('close', () => { res.end(); });
      child.on('error', () => { res.end(); });
      req.on('close', () => { try { child.kill(); } catch {} });

    } else {
      let output = '';
      child.stdout.on('data', c => { output += c.toString(); });
      child.on('close', () => {
        try {
          const lines = output.split('\n');
          const result = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).find(e => e.type === 'result');
          res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: `msg_proxy_${Date.now()}`, type: 'message', role: 'assistant',
            content: [{ type: 'text', text: result?.result || '' }],
            model: model || 'claude-opus-4-6', stop_reason: 'end_turn',
            usage: { input_tokens: result?.usage?.input_tokens || 0, output_tokens: result?.usage?.output_tokens || 0 }
          }));
        } catch (e) {
          res.writeHead(500, cors);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    }
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'claude-proxy' }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Claude Proxy → http://127.0.0.1:${PORT}/v1/messages`);
  console.log(`cwd: ${CLAUDE_CWD} | auth: ${AUTH_TOKEN ? 'enabled' : 'disabled'}`);
});
