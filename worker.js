import { EmailMessage } from "cloudflare:email";

// Simplified header parser without decoding
function parseHeaders(headerText) {
  const headers = {};
  const lines = headerText.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // Handle folded headers
    while (i + 1 < lines.length && /^\s/.test(lines[i + 1])) {
      line += ' ' + lines[i + 1].trim();
      i++;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const name = line.substring(0, colonIndex).trim().toLowerCase();
      const value = line.substring(colonIndex + 1).trim();
      headers[name] = value;
    }
  }

  return headers;
}

// Naive body parser without any encoding handling
function parseEmailBody(rawEmail) {
  const parts = rawEmail.split(/\r?\n\r?\n/);
  if (parts.length < 2) {
    return rawEmail;
  }
  return parts.slice(1).join('\n\n').trim();
}

// Simple formatter preserving line breaks
function formatEmailContent(content) {
  if (!content) return '';
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

export default {
  async email(message, env, ctx) {
    console.log('Timestamp:', new Date().toISOString());
    try {
      if (!message.to.includes('ai@lishuyu.app')) {
        message.reject();
        return;
      }

      // Decode raw email buffer
      const rawBuffer = await new Response(message.raw).arrayBuffer();
      const rawEmail = new TextDecoder('utf-8').decode(rawBuffer);

      const UserEmailPrompt = parseEmailBody(rawEmail);
      console.log('Original length:', rawEmail.length, 'Parsed length:', UserEmailPrompt.length);

      const requestBody = {
        model: env.OPENAI_MODEL,
        messages: [
          { role: 'system', content: env.SystemPrompt },
          { role: 'user', content: UserEmailPrompt }
        ],
        max_tokens: 2000,
        temperature: 0.7
      };

      const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!aiResponse.ok) {
        throw new Error(`OpenAI API error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const generatedReply = aiData.choices[0].message.content.trim();
      const replySubject = 'Re: ' + (message.headers.get('Subject') || '');
      const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2, 11)}@ai.lishuyu.app>`;
      const originalMsgId = message.headers.get('Message-ID');

      const formattedReply = formatEmailContent(generatedReply);
      const formattedPrompt = formatEmailContent(UserEmailPrompt);

      const quotedOriginal = `> On ${message.headers.get('Date') || ''}, ${message.headers.get('From') || message.from} wrote:\n` +
        `> Subject: ${message.headers.get('Subject') || ''}\n>\n` +
        formattedPrompt.split('\n').map(line => `> ${line}`).join('\n');

      const replyEmailContent =
        `Message-ID: ${messageId}\r\n` +
        `In-Reply-To: ${originalMsgId || ''}\r\n` +
        `Subject: ${replySubject}\r\n` +
        `From: AI Email Assistant <ai@lishuyu.app>\r\n` +
        `To: ${message.from}\r\n` +
        `Content-Type: text/plain; charset=utf-8\r\n` +
        `Content-Transfer-Encoding: 8bit\r\n\r\n` +
        `${formattedReply}\r\n\r\n` +
        `${quotedOriginal}`;

      const replyMsg = new EmailMessage(
        'ai@lishuyu.app',
        message.from,
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(replyEmailContent));
            controller.close();
          }
        })
      );

      await message.reply(replyMsg);
    } catch (error) {
      console.error(error);
      try {
        const errorMsgId = `<${Date.now()}.${Math.random().toString(36).substring(2, 11)}@ai.lishuyu.app>`;
        const origId = message.headers.get('Message-ID');
        const errSubject = 'Re: ' + (message.headers.get('Subject') || 'Your Email');
        const errorContent = `Message-ID: ${errorMsgId}\r\n` +
          `In-Reply-To: ${origId || ''}\r\n` +
          `Subject: ${errSubject}\r\n` +
          `From: AI Email Assistant <ai@lishuyu.app>\r\n` +
          `To: ${message.from}\r\n` +
          `Content-Type: text/plain; charset=utf-8\r\n` +
          `Content-Transfer-Encoding: 8bit\r\n\r\n` +
          `I apologize, but I encountered an error while processing your email. Please try again later.`;

        const errReply = new EmailMessage(
          'ai@lishuyu.app',
          message.from,
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(errorContent));
              controller.close();
            }
          })
        );

        await message.reply(errReply);
      } catch (replyErr) {
        console.error('Failed to send error notification', replyErr);
      }
    }
  },

  async fetch(request, env, ctx) {
    console.log(`HTTP Request: ${request.method} ${new URL(request.url).pathname}`);
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Server': 'Cloudflare-Workers' } });
  }
};
