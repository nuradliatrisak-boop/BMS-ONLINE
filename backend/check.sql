SELECT column_name FROM information_schema.columns
WHERE table_name = 'SuratJalan' AND column_name = 'batchId';

SELECT indexname FROM pg_indexes
WHERE tablename = 'SuratJalan' AND indexname = 'SuratJalan_batchId_idx';
