const teamsService = require('./growth-teams.service');
const { success, created } = require('../../utils/response');

class GrowthTeamsController {
  async listTeams(req, res, next) {
    try { success(res, await teamsService.listTeams(req.user.id)); }
    catch (err) { next(err); }
  }

  async createTeam(req, res, next) {
    try { created(res, await teamsService.createTeam(req.user.id, req.body), 'Team created'); }
    catch (err) { next(err); }
  }

  async getTeamDetail(req, res, next) {
    try { success(res, await teamsService.getTeamDetail(req.params.id, req.user.id)); }
    catch (err) { next(err); }
  }

  async updateTeam(req, res, next) {
    try { success(res, await teamsService.updateTeam(req.params.id, req.user.id, req.body), 'Team updated'); }
    catch (err) { next(err); }
  }

  async leaveTeam(req, res, next) {
    try { success(res, await teamsService.leaveTeam(req.params.id, req.user.id), 'Left team'); }
    catch (err) { next(err); }
  }

  async addMember(req, res, next) {
    try { created(res, await teamsService.addMember(req.params.id, req.user.id, req.body), 'Member added'); }
    catch (err) { next(err); }
  }

  async removeMember(req, res, next) {
    try { success(res, await teamsService.removeMember(req.params.id, req.user.id, req.params.memberUserId), 'Member removed'); }
    catch (err) { next(err); }
  }

  async listAvailableUsers(req, res, next) {
    try { success(res, await teamsService.listAvailableUsers(req.user.id)); }
    catch (err) { next(err); }
  }

  async listFriends(req, res, next) {
    try { success(res, await teamsService.listFriends(req.user.id)); }
    catch (err) { next(err); }
  }

  async sendFriendRequest(req, res, next) {
    try { created(res, await teamsService.sendFriendRequest(req.user.id, req.body.addresseeId), 'Friend request sent'); }
    catch (err) { next(err); }
  }

  async respondToFriendRequest(req, res, next) {
    try { success(res, await teamsService.respondToFriendRequest(req.params.friendshipId, req.user.id, req.body.status), 'Friend request updated'); }
    catch (err) { next(err); }
  }

  async removeFriend(req, res, next) {
    try { success(res, await teamsService.removeFriend(req.params.friendshipId, req.user.id), 'Friend removed'); }
    catch (err) { next(err); }
  }

  async getAvailability(req, res, next) {
    try { success(res, await teamsService.getAvailability(req.user.id)); }
    catch (err) { next(err); }
  }

  async setAvailability(req, res, next) {
    try { success(res, await teamsService.setAvailability(req.user.id, req.body.slots), 'Availability updated'); }
    catch (err) { next(err); }
  }

  async detectOverlap(req, res, next) {
    try { success(res, await teamsService.detectOverlap(req.body.userIds)); }
    catch (err) { next(err); }
  }

  async listInvites(req, res, next) {
    try { success(res, await teamsService.listInvites(req.user.id)); }
    catch (err) { next(err); }
  }

  async respondToInvite(req, res, next) {
    try { success(res, await teamsService.respondToInvite(req.params.inviteId, req.user.id, req.body.status), 'Invite responded'); }
    catch (err) { next(err); }
  }
}

module.exports = new GrowthTeamsController();
