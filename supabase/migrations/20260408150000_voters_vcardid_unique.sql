-- EPIC (vcardid) is unique: normalize, dedupe existing rows, then enforce uniqueness.

UPDATE voters SET vcardid = NULL WHERE vcardid IS NOT NULL AND BTRIM(vcardid) = '';

UPDATE voters SET vcardid = UPPER(BTRIM(vcardid)) WHERE vcardid IS NOT NULL;

DELETE FROM voters a
WHERE a.vcardid IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM voters b
    WHERE b.vcardid = a.vcardid AND b.id < a.id
  );

DROP INDEX IF EXISTS idx_voters_vcardid;

CREATE UNIQUE INDEX idx_voters_vcardid ON voters (vcardid);
