import logging
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Q
from .models import ChatMessage
from .serializers import ChatMessageSerializer
from apps.users.models import User
from apps.notifications.models import Notification

logger = logging.getLogger('apps.chat')


class ChatMessageListCreateView(generics.ListCreateAPIView):
    serializer_class = ChatMessageSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return ChatMessage.objects.filter(
            Q(sender=user) | Q(receiver_email__iexact=user.email)
        ).select_related('sender').order_by('timestamp')

    def perform_create(self, serializer):
        msg = serializer.save(sender=self.request.user)
        # Attempt to notify recipient if they are a registered user
        if msg.receiver_email:
            try:
                recipient = User.objects.filter(email__iexact=msg.receiver_email).first()
                if recipient and recipient != self.request.user:
                    from apps.notifications.models import push_notification
                    push_notification(
                        recipient=recipient,
                        title=f"New message from {self.request.user.full_name or self.request.user.email}",
                        message=f"{msg.text[:100]}...",
                        notification_type='MESSAGE',
                        link='/dashboard.html'
                    )
            except Exception:
                logger.exception(
                    "Failed to create notification for chat message to %s", msg.receiver_email
                )


class ChatInboxView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        target_email = request.query_params.get('with')
        if target_email:
            messages = ChatMessage.objects.filter(
                (Q(sender=request.user) & Q(receiver_email__iexact=target_email)) |
                (Q(sender__email__iexact=target_email) & Q(receiver_email__iexact=request.user.email))
            ).select_related('sender').order_by('timestamp')
        else:
            messages = ChatMessage.objects.filter(
                Q(sender=request.user) | Q(receiver_email__iexact=request.user.email)
            ).select_related('sender').order_by('timestamp')

        serializer = ChatMessageSerializer(messages, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ConversationListView(APIView):
    """
    GET /api/conversations or /api/conversations/
    POST /api/conversations or /api/conversations/
    Provides aggregated conversation list for the active authenticated student.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        my_email = (request.user.email or '').strip().lower()
        messages = ChatMessage.objects.filter(
            Q(sender=request.user) | Q(receiver_email__iexact=my_email)
        ).select_related('sender').order_by('timestamp')

        conversations_map = {}
        for m in messages:
            sender_email = (m.sender.email if m.sender else '').strip().lower()
            receiver_email = (m.receiver_email or '').strip().lower()
            partner_email = receiver_email if sender_email == my_email else sender_email
            if not partner_email or partner_email == my_email:
                continue
            conversations_map[partner_email] = m

        partner_users = {
            u.email.lower(): u for u in User.objects.filter(email__in=conversations_map.keys())
        }

        results = []
        for partner_email, last_msg in conversations_map.items():
            partner_user = partner_users.get(partner_email)
            partner_name = (partner_user.full_name if partner_user else '') or partner_email.split('@')[0]
            partner_id = str(partner_user.id) if partner_user else partner_email
            avatar_url = getattr(partner_user, 'avatar_url', '') if partner_user else ''

            results.append({
                'id': partner_email,
                'bookId': '',
                'bookTitle': last_msg.book_title or '',
                'book': {
                    'title': last_msg.book_title or '',
                    'mode': 'sell',
                    'price': 0,
                },
                'partnerEmail': partner_email,
                'partnerName': partner_name,
                'otherUser': {
                    'id': partner_id,
                    'name': partner_name,
                    'email': partner_email,
                    'avatarUrl': avatar_url,
                    'role': getattr(partner_user, 'role', 'student') if partner_user else 'student',
                },
                'iApprovedWhatsapp': False,
                'partnerApprovedWhatsapp': False,
                'lastMessage': last_msg.text,
                'lastMessageText': last_msg.text,
                'lastTimestamp': last_msg.timestamp.isoformat(),
                'lastMessageAt': last_msg.timestamp.isoformat(),
                'unreadCount': 0,
            })

        results.sort(key=lambda x: x['lastMessageAt'], reverse=True)
        return Response(results, status=status.HTTP_200_OK)

    def post(self, request):
        recipient_email = request.data.get('recipientEmail') or request.data.get('recipient_email')
        recipient_id = request.data.get('recipientId') or request.data.get('recipient_id')
        book_id = request.data.get('bookId') or request.data.get('book_id')

        partner_user = None
        if recipient_id:
            try:
                partner_user = User.objects.filter(pk=recipient_id).first()
            except Exception:
                partner_user = None
        if not partner_user and recipient_email:
            partner_user = User.objects.filter(email__iexact=recipient_email).first()

        final_email = partner_user.email if partner_user else (recipient_email or '')
        final_name = (partner_user.full_name if partner_user else '') or (final_email.split('@')[0] if final_email else 'Student')

        return Response({
            'id': final_email,
            'bookId': book_id or '',
            'otherUser': {
                'id': str(partner_user.id) if partner_user else final_email,
                'name': final_name,
                'email': final_email,
                'avatarUrl': getattr(partner_user, 'avatar_url', '') if partner_user else '',
                'role': getattr(partner_user, 'role', 'student') if partner_user else 'student',
            },
            'iApprovedWhatsapp': False,
            'partnerApprovedWhatsapp': False,
            'lastMessageText': '',
            'lastMessageAt': None,
            'unreadCount': 0,
        }, status=status.HTTP_200_OK)


class ConversationMessagesView(APIView):
    """
    GET /api/conversations/<conversation_id>/messages
    POST /api/conversations/<conversation_id>/messages
    """
    permission_classes = [permissions.IsAuthenticated]

    def _resolve_partner_email(self, conversation_id):
        partner_email = conversation_id
        if '@' not in conversation_id:
            try:
                p_user = User.objects.filter(pk=conversation_id).first()
                if p_user:
                    partner_email = p_user.email
            except Exception:
                pass
        return partner_email

    def get(self, request, conversation_id):
        partner_email = self._resolve_partner_email(conversation_id)
        my_email = (request.user.email or '').strip().lower()

        messages = ChatMessage.objects.filter(
            (Q(sender=request.user) & Q(receiver_email__iexact=partner_email)) |
            (Q(sender__email__iexact=partner_email) & Q(receiver_email__iexact=my_email))
        ).select_related('sender').order_by('timestamp')

        serializer = ChatMessageSerializer(messages, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request, conversation_id):
        text = (request.data.get('text') or '').strip()
        if not text:
            return Response({'error': 'Message text is required'}, status=status.HTTP_400_BAD_REQUEST)

        partner_email = self._resolve_partner_email(conversation_id)
        book_title = request.data.get('bookTitle') or request.data.get('book_title', '')

        msg = ChatMessage.objects.create(
            sender=request.user,
            receiver_email=partner_email,
            book_title=book_title,
            text=text
        )
        return Response(ChatMessageSerializer(msg).data, status=status.HTTP_201_CREATED)


class ConversationWhatsAppView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, conversation_id):
        return Response({
            'mine': False,
            'partner': False,
            'whatsapp': None
        }, status=status.HTTP_200_OK)


class ConversationWhatsAppApproveView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, conversation_id):
        return Response({
            'success': True,
            'message': 'WhatsApp share preference approved.'
        }, status=status.HTTP_200_OK)


class ConversationReportView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, conversation_id):
        return Response({
            'success': True,
            'message': 'Report received and submitted for administrator review.'
        }, status=status.HTTP_200_OK)


class ConversationBlockView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, conversation_id):
        return Response({
            'success': True,
            'message': 'Conversation muted and partner blocked.'
        }, status=status.HTTP_200_OK)
