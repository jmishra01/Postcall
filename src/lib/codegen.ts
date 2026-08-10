import type { RequestInput } from './types';

export type CodeLanguage = 'curl' | 'javascript' | 'python' | 'go' | 'rust' | 'csharp' | 'php';

export const codeLanguageOptions: Array<{ id: CodeLanguage; label: string; detail: string }> = [
  { id: 'curl', label: 'cURL', detail: 'Command line' },
  { id: 'javascript', label: 'JavaScript', detail: 'Fetch' },
  { id: 'python', label: 'Python', detail: 'Requests' },
  { id: 'go', label: 'Go', detail: 'net/http' },
  { id: 'rust', label: 'Rust', detail: 'reqwest' },
  { id: 'csharp', label: 'C#', detail: 'HttpClient' },
  { id: 'php', label: 'PHP', detail: 'cURL' }
];

const jsString = (value: string) => JSON.stringify(value);
const pythonString = jsString;
const goString = jsString;
const csharpString = (value: string) => `@"${value.replaceAll('"', '""')}"`;
const phpString = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

function rustString(value: string) {
  let hashes = '';
  while (value.includes(`"${hashes}`)) hashes += '#';
  return `r${hashes}"${value}"${hashes}`;
}

function generateCurl(input: RequestInput) {
  const parts = [`curl --request ${input.method}`, `  --url ${shellQuote(input.url)}`];
  input.headers.forEach(([key, value]) => parts.push(`  --header ${shellQuote(`${key}: ${value}`)}`));
  if (input.followRedirects) parts.push('  --location');
  if (!input.validateCertificates) parts.push('  --insecure');
  if (input.timeoutMs) parts.push(`  --max-time ${Math.max(.001, input.timeoutMs / 1000)}`);
  if (input.multipart?.length) {
    input.multipart.forEach((field) => parts.push(`  --form ${shellQuote(`${field.name}=${field.kind === 'file' ? `@${field.fileName ?? 'upload.bin'}` : field.value}`)}`));
  } else if (input.binary) parts.push(`  --data-binary ${shellQuote(`@${input.binary.fileName}`)}`);
  else if (input.body !== undefined) parts.push(`  --data ${shellQuote(input.body)}`);
  return parts.join(' \\\n');
}

function generateJavaScript(input: RequestInput) {
  const lines: string[] = [];
  const needsFile = Boolean(input.binary || input.multipart?.some((field) => field.kind === 'file'));
  if (needsFile) lines.push("import { readFile } from 'node:fs/promises';", '');
  let bodyExpression = '';
  if (input.multipart?.length) {
    lines.push('const formData = new FormData();');
    input.multipart.forEach((field) => {
      if (field.kind === 'file') {
        const fileName = field.fileName ?? 'upload.bin';
        lines.push(`formData.append(${jsString(field.name)}, new Blob([await readFile(${jsString(fileName)})], { type: ${jsString(field.mimeType ?? 'application/octet-stream')} }), ${jsString(fileName)});`);
      } else lines.push(`formData.append(${jsString(field.name)}, ${jsString(field.value)});`);
    });
    lines.push('');
    bodyExpression = 'formData';
  } else if (input.binary) bodyExpression = `await readFile(${jsString(input.binary.fileName)})`;
  else if (input.body !== undefined) bodyExpression = jsString(input.body);

  lines.push(
    'const controller = new AbortController();',
    `const timeout = setTimeout(() => controller.abort(), ${input.timeoutMs});`,
    '',
    `const response = await fetch(${jsString(input.url)}, {`,
    `  method: ${jsString(input.method)},`
  );
  if (input.headers.length) {
    lines.push('  headers: [', ...input.headers.map(([key, value]) => `    [${jsString(key)}, ${jsString(value)}],`), '  ],');
  }
  if (bodyExpression) lines.push(`  body: ${bodyExpression},`);
  lines.push(`  redirect: ${jsString(input.followRedirects ? 'follow' : 'manual')},`, '  signal: controller.signal,', '});', '', 'clearTimeout(timeout);', 'console.log(response.status);', 'console.log(await response.text());');
  if (!input.validateCertificates) lines.unshift('// Certificate validation cannot be disabled with the standard Fetch API.');
  return lines.join('\n');
}

function generatePython(input: RequestInput) {
  const seconds = Math.max(.001, input.timeoutMs / 1000);
  const lines = ['import requests', ''];
  if (input.headers.length) {
    lines.push('headers = {', ...input.headers.map(([key, value]) => `    ${pythonString(key)}: ${pythonString(value)},`), '}', '');
  }
  const argumentsList = [pythonString(input.method), pythonString(input.url)];
  if (input.headers.length) argumentsList.push('headers=headers');
  if (input.multipart?.length) {
    const textFields = input.multipart.filter((field) => field.kind === 'text');
    const fileFields = input.multipart.filter((field) => field.kind === 'file');
    if (textFields.length) lines.push('data = [', ...textFields.map((field) => `    (${pythonString(field.name)}, ${pythonString(field.value)}),`), ']', '');
    if (fileFields.length) lines.push('files = [', ...fileFields.map((field) => {
      const fileName = field.fileName ?? 'upload.bin';
      return `    (${pythonString(field.name)}, (${pythonString(fileName)}, open(${pythonString(fileName)}, "rb"), ${pythonString(field.mimeType ?? 'application/octet-stream')})),`;
    }), ']', '');
    if (textFields.length) argumentsList.push('data=data');
    if (fileFields.length) argumentsList.push('files=files');
  } else if (input.binary) argumentsList.push(`data=open(${pythonString(input.binary.fileName)}, "rb")`);
  else if (input.body !== undefined) argumentsList.push(`data=${pythonString(input.body)}`);
  argumentsList.push(`timeout=${seconds}`, `allow_redirects=${input.followRedirects ? 'True' : 'False'}`, `verify=${input.validateCertificates ? 'True' : 'False'}`);
  lines.push('response = requests.request(', ...argumentsList.map((argument) => `    ${argument},`), ')', '', 'print(response.status_code)', 'print(response.text)');
  return lines.join('\n');
}

function generateGo(input: RequestInput) {
  const imports = new Set(['fmt', 'io', 'net/http', 'time']);
  const setup: string[] = [];
  let bodyExpression = 'nil';
  const multipartHeaders = new Set<string>();
  if (input.multipart?.length) {
    imports.add('bytes'); imports.add('mime/multipart'); imports.add('os');
    setup.push('var body bytes.Buffer', 'writer := multipart.NewWriter(&body)');
    input.multipart.forEach((field, index) => {
      if (field.kind === 'file') {
        const fileName = field.fileName ?? 'upload.bin';
        setup.push(
          `file${index}, err := os.Open(${goString(fileName)})`,
          'if err != nil { panic(err) }',
          `defer file${index}.Close()`,
          `part${index}, err := writer.CreateFormFile(${goString(field.name)}, ${goString(fileName)})`,
          'if err != nil { panic(err) }',
          `if _, err = io.Copy(part${index}, file${index}); err != nil { panic(err) }`
        );
      } else setup.push(`if err := writer.WriteField(${goString(field.name)}, ${goString(field.value)}); err != nil { panic(err) }`);
    });
    setup.push('if err := writer.Close(); err != nil { panic(err) }');
    bodyExpression = '&body';
    multipartHeaders.add('content-type');
  } else if (input.binary) {
    imports.add('os');
    setup.push(`body, err := os.Open(${goString(input.binary.fileName)})`, 'if err != nil { panic(err) }', 'defer body.Close()');
    bodyExpression = 'body';
  } else if (input.body !== undefined) {
    imports.add('strings');
    bodyExpression = `strings.NewReader(${goString(input.body)})`;
  }
  if (!input.validateCertificates) imports.add('crypto/tls');
  const lines = [
    'package main', '', 'import (',
    ...[...imports].sort().map((name) => `\t${goString(name)}`),
    ')', '', 'func main() {',
    ...setup.map((line) => `\t${line}`),
    ...(setup.length ? [''] : []),
    `\treq, err := http.NewRequest(${goString(input.method)}, ${goString(input.url)}, ${bodyExpression})`,
    '\tif err != nil { panic(err) }'
  ];
  if (input.multipart?.length) lines.push('\treq.Header.Set("Content-Type", writer.FormDataContentType())');
  input.headers.filter(([key]) => !multipartHeaders.has(key.toLowerCase())).forEach(([key, value]) => lines.push(`\treq.Header.Add(${goString(key)}, ${goString(value)})`));
  lines.push('', `\tclient := &http.Client{Timeout: ${input.timeoutMs} * time.Millisecond}`);
  if (!input.followRedirects) lines.push('\tclient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }');
  if (!input.validateCertificates) {
    lines.push('\tclient.Transport = &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}} // Use only for local testing.');
  }
  lines.push('\tresponse, err := client.Do(req)', '\tif err != nil { panic(err) }', '\tdefer response.Body.Close()', '\tresponseBody, err := io.ReadAll(response.Body)', '\tif err != nil { panic(err) }', '', '\tfmt.Println(response.Status)', '\tfmt.Println(string(responseBody))', '}');
  return lines.join('\n');
}

function generateRust(input: RequestInput) {
  const lines = [
    'use reqwest::{Client, Method};',
    'use std::{error::Error, time::Duration};'
  ];
  if (input.multipart?.length) lines[0] = 'use reqwest::{multipart, Client, Method};';
  lines.push('', '#[tokio::main]', 'async fn main() -> Result<(), Box<dyn Error>> {', '    let client = Client::builder()', `        .timeout(Duration::from_millis(${input.timeoutMs}))`, `        .redirect(reqwest::redirect::Policy::${input.followRedirects ? 'limited(10)' : 'none()'})`, `        .danger_accept_invalid_certs(${!input.validateCertificates})`, '        .build()?;', '', `    let mut request = client.request(Method::from_bytes(${rustString(input.method)}.as_bytes())?, ${rustString(input.url)});`);
  input.headers.forEach(([key, value]) => lines.push(`    request = request.header(${rustString(key)}, ${rustString(value)});`));
  if (input.multipart?.length) {
    lines.push('    let mut form = multipart::Form::new();');
    input.multipart.forEach((field, index) => {
      if (field.kind === 'file') {
        const fileName = field.fileName ?? 'upload.bin';
        lines.push(`    let bytes${index} = tokio::fs::read(${rustString(fileName)}).await?;`, `    let part${index} = multipart::Part::bytes(bytes${index})`, `        .file_name(${rustString(fileName)})`, `        .mime_str(${rustString(field.mimeType ?? 'application/octet-stream')})?;`, `    form = form.part(${rustString(field.name)}, part${index});`);
      } else lines.push(`    form = form.text(${rustString(field.name)}, ${rustString(field.value)});`);
    });
    lines.push('    request = request.multipart(form);');
  } else if (input.binary) lines.push(`    request = request.body(tokio::fs::read(${rustString(input.binary.fileName)}).await?);`);
  else if (input.body !== undefined) lines.push(`    request = request.body(${rustString(input.body)});`);
  lines.push('', '    let response = request.send().await?;', '    println!("{}", response.status());', '    println!("{}", response.text().await?);', '    Ok(())', '}');
  return lines.join('\n');
}

function generateCSharp(input: RequestInput) {
  const lines = ['using System;', 'using System.IO;', 'using System.Net.Http;', 'using System.Net.Http.Headers;', '', `var handler = new HttpClientHandler { AllowAutoRedirect = ${input.followRedirects ? 'true' : 'false'} };`];
  if (!input.validateCertificates) lines.push('handler.ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator; // Local testing only.');
  lines.push('using var client = new HttpClient(handler);', `client.Timeout = TimeSpan.FromMilliseconds(${input.timeoutMs});`, `using var request = new HttpRequestMessage(new HttpMethod(${csharpString(input.method)}), ${csharpString(input.url)});`);
  if (input.multipart?.length) {
    lines.push('var content = new MultipartFormDataContent();');
    input.multipart.forEach((field, index) => {
      if (field.kind === 'file') {
        const fileName = field.fileName ?? 'upload.bin';
        lines.push(`var file${index} = new StreamContent(File.OpenRead(${csharpString(fileName)}));`, `file${index}.Headers.ContentType = new MediaTypeHeaderValue(${csharpString(field.mimeType ?? 'application/octet-stream')});`, `content.Add(file${index}, ${csharpString(field.name)}, ${csharpString(fileName)});`);
      } else lines.push(`content.Add(new StringContent(${csharpString(field.value)}), ${csharpString(field.name)});`);
    });
    lines.push('request.Content = content;');
  } else if (input.binary) lines.push(`request.Content = new StreamContent(File.OpenRead(${csharpString(input.binary.fileName)}));`);
  else if (input.body !== undefined) lines.push(`request.Content = new StringContent(${csharpString(input.body)});`);
  input.headers.forEach(([key, value]) => lines.push(`if (!request.Headers.TryAddWithoutValidation(${csharpString(key)}, ${csharpString(value)}))`, '{', `    request.Content?.Headers.Remove(${csharpString(key)});`, `    request.Content?.Headers.TryAddWithoutValidation(${csharpString(key)}, ${csharpString(value)});`, '}'));
  lines.push('', 'using var response = await client.SendAsync(request);', 'Console.WriteLine($"{(int)response.StatusCode} {response.ReasonPhrase}");', 'Console.WriteLine(await response.Content.ReadAsStringAsync());');
  return lines.join('\n');
}

function generatePhp(input: RequestInput) {
  const lines = ['<?php', `$curl = curl_init(${phpString(input.url)});`, ''];
  let bodyExpression = '';
  if (input.multipart?.length) {
    lines.push('$fields = [');
    input.multipart.forEach((field) => {
      if (field.kind === 'file') {
        const fileName = field.fileName ?? 'upload.bin';
        lines.push(`    ${phpString(field.name)} => new CURLFile(${phpString(fileName)}, ${phpString(field.mimeType ?? 'application/octet-stream')}, ${phpString(fileName)}),`);
      } else lines.push(`    ${phpString(field.name)} => ${phpString(field.value)},`);
    });
    lines.push('];', '');
    bodyExpression = '$fields';
  } else if (input.binary) bodyExpression = `file_get_contents(${phpString(input.binary.fileName)})`;
  else if (input.body !== undefined) bodyExpression = phpString(input.body);
  lines.push('curl_setopt_array($curl, [', '    CURLOPT_RETURNTRANSFER => true,', `    CURLOPT_CUSTOMREQUEST => ${phpString(input.method)},`, `    CURLOPT_FOLLOWLOCATION => ${input.followRedirects ? 'true' : 'false'},`, `    CURLOPT_SSL_VERIFYPEER => ${input.validateCertificates ? 'true' : 'false'},`, `    CURLOPT_TIMEOUT_MS => ${input.timeoutMs},`);
  if (input.headers.length) lines.push('    CURLOPT_HTTPHEADER => [', ...input.headers.map(([key, value]) => `        ${phpString(`${key}: ${value}`)},`), '    ],');
  if (bodyExpression) lines.push(`    CURLOPT_POSTFIELDS => ${bodyExpression},`);
  lines.push(']);', '', '$response = curl_exec($curl);', 'if ($response === false) {', '    throw new RuntimeException(curl_error($curl));', '}', '', 'echo curl_getinfo($curl, CURLINFO_RESPONSE_CODE), PHP_EOL;', 'echo $response, PHP_EOL;', 'curl_close($curl);');
  return lines.join('\n');
}

export function generateRequestCode(language: CodeLanguage, input: RequestInput) {
  if (language === 'javascript') return generateJavaScript(input);
  if (language === 'python') return generatePython(input);
  if (language === 'go') return generateGo(input);
  if (language === 'rust') return generateRust(input);
  if (language === 'csharp') return generateCSharp(input);
  if (language === 'php') return generatePhp(input);
  return generateCurl(input);
}
