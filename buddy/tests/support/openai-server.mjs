// Test-only HTTP fixture. Production uses the same OpenAI wrapper against OpenAI.
import http from 'node:http';
http.createServer(async (req, res) => {
  if (req.method === 'GET') { res.end('ok'); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const text = body.input.at(-1).content;
  const call = /Friday/i.test(text)
    ? { name: 'protect_time_block', arguments: { days: ['Fri'], start_time: '19:00', end_time: '24:00' } }
    : { name: 'set_preferred_work_hours', arguments: { start_time: '17:00', end_time: '23:00', strength: 'firm' } };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: 'resp_fixture', object: 'response', status: 'completed', output: [
    { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'I will apply your study preference.', annotations: [] }] },
    { type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: call.name, arguments: JSON.stringify(call.arguments) },
  ] }));
}).listen(8102, '127.0.0.1');
