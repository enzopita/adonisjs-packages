import vine from '@vinejs/vine'

export const searchProbeValidator = vine.create({
  filter: vine
    .object({
      status: vine.enum(['active', 'disabled']).optional(),
    })
    .optional(),
})

export const echoProbeValidator = vine.create({
  message: vine.string(),
})

/**
 * `request.validateUsing()` validates the body merged with the query string, so `query` is a
 * field like any other: `?query[page]=2` or `{ "query": { "page": 2 } }`, never `?page=2`.
 */
export const pagedProbeValidator = vine.create({
  query: vine.object({
    page: vine.number(),
  }),
})

export const nullableProbeValidator = vine.create({
  nickname: vine.string().nullable(),
  bio: vine.string().optional(),
  website: vine.string().nullable().optional(),
})

/**
 * A body that is the `params` plus one of the group's branches, picked by `channel`.
 */
export const sentMessageProbeValidator = vine.create(
  vine
    .object({
      params: vine.object({
        id: vine.number().withoutDecimals().min(1),
      }),
    })
    .merge(
      vine.group([
        vine.group.if(data => data.channel === 'rcs', {
          channel: vine.literal('rcs'),
          templateId: vine.string().uuid(),
        }),
        vine.group.else({
          channel: vine.literal('sms'),
          text: vine.string().maxLength(160),
        }),
      ]),
    ),
)
