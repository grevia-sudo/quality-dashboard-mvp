import { getUserByUsername } from '../server/db.ts';

try {
  const result = await getUserByUsername('Kiddliao');
  console.log('RESULT', result);
} catch (error) {
  console.error('ERROR_NAME', error?.name);
  console.error('ERROR_MESSAGE', error?.message);
  console.error('ERROR_CODE', error?.code);
  console.error('ERROR_CAUSE', error?.cause);
  console.error('ERROR_STACK', error?.stack);
  console.error('ERROR_FULL', error);
}
