DELETE FROM vocabulary
WHERE id NOT IN (
  SELECT MIN(id)
  FROM vocabulary
  GROUP BY book_id, lower(word)
);

CREATE UNIQUE INDEX idx_vocab_book_word
ON vocabulary(book_id, lower(word));
