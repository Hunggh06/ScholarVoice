// Cloudflare Worker - AI Proxy cho tool dạy học
// Deploy lên Cloudflare Workers, sau đó dán URL vào tool

export default {
  async fetch(request, env) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Chỉ hỗ trợ POST' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await request.json();
      const messages = body.messages || [];
      const model = body.model || '@cf/moonshotai/kimi-k2.6';

      const result = await env.AI.run(model, {
        messages,
        stream: false,
      });

      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: result.response || result
          }
        }]
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (err) {
      return new Response(JSON.stringify({
        error: { message: err.message || 'Lỗi Cloudflare AI' }
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};
