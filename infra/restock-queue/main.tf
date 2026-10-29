/**
 * Restock notification queue infrastructure (SQS + ECS Fargate workers).
 *
 * Apply with:
 *   cd infra/restock-queue && terraform init && terraform apply
 *
 * Requires AWS credentials and an existing VPC / subnets / ECR image.
 */

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "name_prefix" {
  type    = string
  default = "wishlist-restock"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "worker_image" {
  type        = string
  description = "ECR image URI for the restock worker container"
}

variable "database_url_secret_arn" {
  type        = string
  description = "Secrets Manager ARN containing DATABASE_URL"
}

variable "worker_desired_count" {
  type    = number
  default = 2
}

variable "worker_cpu" {
  type    = number
  default = 256
}

variable "worker_memory" {
  type    = number
  default = 512
}

provider "aws" {
  region = var.aws_region
}

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name_prefix}-notifications-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "notifications" {
  name                       = "${var.name_prefix}-notifications"
  visibility_timeout_seconds = 60
  receive_wait_time_seconds  = 10
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${var.name_prefix}-worker"
  retention_in_days = 14
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "${var.name_prefix}-ecs-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "${var.name_prefix}-ecs-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_sqs" {
  name = "${var.name_prefix}-sqs"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:SendMessage",
          "sqs:ChangeMessageVisibility"
        ]
        Resource = [
          aws_sqs_queue.notifications.arn,
          aws_sqs_queue.dlq.arn
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [var.database_url_secret_arn]
      }
    ]
  })
}

resource "aws_ecs_cluster" "restock" {
  name = "${var.name_prefix}-cluster"
}

resource "aws_security_group" "worker" {
  name        = "${var.name_prefix}-worker"
  description = "Restock worker egress"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name_prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "restock-worker"
    image     = var.worker_image
    essential = true
    command   = ["npm", "run", "worker:restock"]
    environment = [
      { name = "AWS_REGION", value = var.aws_region },
      { name = "AWS_SQS_QUEUE_URL", value = aws_sqs_queue.notifications.url },
      { name = "AWS_SQS_VISIBILITY_TIMEOUT", value = "60" },
      { name = "RESTOCK_WORKER_CONCURRENCY", value = "10" },
      { name = "RESTOCK_QUEUE_ENABLED", value = "true" }
    ]
    secrets = [
      {
        name      = "DATABASE_URL"
        valueFrom = var.database_url_secret_arn
      }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.worker.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "worker"
      }
    }
  }])
}

resource "aws_ecs_service" "worker" {
  name            = "${var.name_prefix}-worker"
  cluster         = aws_ecs_cluster.restock.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = false
  }

  lifecycle {
    ignore_changes = [desired_count]
  }
}

resource "aws_appautoscaling_target" "worker" {
  max_capacity       = 10
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.restock.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "worker_sqs" {
  name               = "${var.name_prefix}-sqs-depth"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value = 1000
    customized_metric_specification {
      metric_name = "ApproximateNumberOfMessagesVisible"
      namespace   = "AWS/SQS"
      statistic   = "Average"
      unit        = "Count"
      dimensions = {
        QueueName = aws_sqs_queue.notifications.name
      }
    }
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
  }
}

output "sqs_queue_url" {
  value = aws_sqs_queue.notifications.url
}

output "sqs_dlq_url" {
  value = aws_sqs_queue.dlq.url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.restock.name
}

output "ecs_service_name" {
  value = aws_ecs_service.worker.name
}
