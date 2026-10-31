-- Limpeza de dados, nao de esquema.
--
-- As vagas gravadas antes da correcao guardam o HTML cru que o anunciante
-- escreveu — a Remotar manda `<p>`, `<strong>` e listas no corpo — e o painel
-- exibia a marcacao no lugar do texto. Uma captura nova NAO conserta essas
-- linhas: o repositorio so renova `lastSeenAt` da vaga que ja existe, nunca
-- reescreve a descricao. Por isso a limpeza vem aqui, no mesmo
-- `migrate deploy` que a VPS roda a cada deploy.
--
-- A remocao e por nome de elemento conhecido, e nao "tudo entre < e >", pelo
-- mesmo motivo do `removeHtmlTags`: o corpo das issues do GitHub e Markdown, e
-- um autolink `<https://empresa.com/vaga>` ou um generico `List<String>`
-- desapareceriam junto com as tags.

UPDATE "jobs" AS j
SET "description" = limpa.texto
FROM (
  SELECT
    "id",
    btrim(
      -- 5. espaco solto em volta da quebra, e no maximo uma linha em branco
      regexp_replace(
        regexp_replace(
          -- 4. entidades, depois da remocao: um `&lt;p&gt;` escrito de
          --    proposito volta a ser texto visivel, e nao tag a remover
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      -- 3. espacos horizontais repetidos viram um
                      regexp_replace(
                        -- 2. o que sobrou de tag conhecida sai sem deixar marca
                        regexp_replace(
                          -- 1. fim de bloco vira quebra de linha, como o `BLOCK_TAG`
                          --    do `htmlToText`
                          regexp_replace(
                            "description",
                            '<[[:space:]]*(br|/p|/li|/ul|/ol|/h[1-6]|/div|/tr)'
                              || '([[:space:]/][^>]*)?>',
                            E'\n',
                            'gi'
                          ),
                          '</?(p|br|hr|div|span|strong|b|em|i|u|s|ul|ol|li|dl|dt|dd|h[1-6]|a|img'
                            || '|figure|table|thead|tbody|tfoot|tr|td|th|code|pre|blockquote|sub'
                            || '|sup|small|font|center|details|summary|section|article|header'
                            || '|footer|nav|aside|main|label|button)([[:space:]/][^>]*)?>',
                          '',
                          'gi'
                        ),
                        '[ \t]+',
                        ' ',
                        'g'
                      ),
                      '&nbsp;', ' '
                    ),
                    '&amp;', '&'
                  ),
                  '&quot;', '"'
                ),
                '&#39;', ''''
              ),
              '&lt;', '<'
            ),
            '&gt;', '>'
          ),
          ' ?\n ?',
          E'\n',
          'g'
        ),
        E'\n{3,}',
        E'\n\n',
        'g'
      ),
      -- 6. sobra de espaco e de quebra nas pontas
      E' \t\n\r'
    ) AS texto
  FROM "jobs"
  WHERE "description" ~* (
         '</?(p|br|hr|div|span|strong|b|em|i|u|s|ul|ol|li|dl|dt|dd|h[1-6]|a|img'
           || '|figure|table|thead|tbody|tfoot|tr|td|th|code|pre|blockquote|sub'
           || '|sup|small|font|center|details|summary|section|article|header'
           || '|footer|nav|aside|main|label|button)([[:space:]/][^>]*)?>'
       )
     OR "description" ~ '&(nbsp|amp|quot|lt|gt|#39);'
) AS limpa
WHERE j."id" = limpa."id" AND j."description" <> limpa.texto;
