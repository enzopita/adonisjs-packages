import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

router.get('numeric', [controllers.Broken, 'numeric'])
router.get('union', [controllers.Broken, 'union'])
router.get('duplicate', [controllers.Broken, 'duplicate'])
router.get('missing', [controllers.Broken, 'missing'])
router.get('escaped', [controllers.Broken, 'escaped'])
router.get('underived', [controllers.Broken, 'underived'])
router.get('misspelled', [controllers.Broken, 'misspelled'])
router.get('unread', [controllers.Broken, 'unread'])
