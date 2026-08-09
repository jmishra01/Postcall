<script lang="ts">
  export let value = '';
  export let language = 'json';
  export let placeholder = '';
  export let onChange: () => void = () => {};

  $: lineCount = Math.max(1, value.split('\n').length);
</script>

<div class="code-editor">
  <div class="line-numbers" aria-hidden="true">
    {#each Array(lineCount) as _, index}<span>{index + 1}</span>{/each}
  </div>
  <textarea
    bind:value
    on:input={onChange}
    {placeholder}
    spellcheck="false"
    aria-label={`${language} editor`}
  ></textarea>
</div>

