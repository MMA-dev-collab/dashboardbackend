const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const teamsController = require('./growth-teams.controller');
const { validate } = require('../../middleware/validate');
const {
  createTeamSchema, updateTeamSchema, addMemberSchema,
  friendRequestSchema, respondFriendSchema, setAvailabilitySchema,
  overlapSchema, respondInviteSchema,
} = require('./growth-teams.validator');

const router = Router();

router.use(authenticate);

router.get('/', teamsController.listTeams);
router.post('/', validate(createTeamSchema), teamsController.createTeam);
router.get('/friends', teamsController.listFriends);
router.get('/users/available', teamsController.listAvailableUsers);
router.post('/friends/request', validate(friendRequestSchema), teamsController.sendFriendRequest);
router.patch('/friends/:friendshipId', validate(respondFriendSchema), teamsController.respondToFriendRequest);
router.delete('/friends/:friendshipId', teamsController.removeFriend);
router.get('/availability', teamsController.getAvailability);
router.post('/availability', validate(setAvailabilitySchema), teamsController.setAvailability);
router.post('/overlap', validate(overlapSchema), teamsController.detectOverlap);
router.get('/invites', teamsController.listInvites);
router.post('/invites/:inviteId/respond', validate(respondInviteSchema), teamsController.respondToInvite);

router.get('/:id', teamsController.getTeamDetail);
router.put('/:id', validate(updateTeamSchema), teamsController.updateTeam);
router.delete('/:id', teamsController.leaveTeam);
router.post('/:id/members', validate(addMemberSchema), teamsController.addMember);
router.delete('/:id/members/:memberUserId', teamsController.removeMember);

module.exports = router;
